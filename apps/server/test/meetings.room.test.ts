import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as SdkRoom } from '@colyseus/sdk'
import {
  findMeetingRooms,
  MEETING_ENTRY_WINDOW_MS,
  Message,
  newPersonId,
  playerStatus,
  rectContains,
  roomNameFor,
  seatAnchor,
  type ChatMessagePayload,
  type MeetingEndedPayload,
  type MeetingErrorPayload,
  type MeetingRoom,
  type MeetingSchedulePayload,
  type OfficeState,
} from '@vto/shared'
import app from '../src/app.config'
import { worldMap } from '../src/map'
import { meetings } from '../src/meetings'
import type { WorldRoom } from '../src/rooms/WorldRoom'

type TestClient = SdkRoom<WorldRoom, OfficeState>

/** The world with the meeting rooms. */
const FIRST = 'first-office'
const CHIRON = 'chiron-office'

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/**
 * Meetings, from the server's side.
 *
 * A meeting is the one thing in this office that is planned rather than
 * bumped into: it is booked into a room, it holds that room against anybody
 * else, it lets exactly the people invited in, and when the time comes it
 * seats them at a table wider than the distance a conversation normally
 * carries. Every one of those is the server's decision and none of them can
 * be talked out of it by a client, which is what is tested here — along with
 * the ways a person stops being in one, all of which have to give the chair
 * back and take them off the list.
 */
describe("A world's room: meetings", () => {
  let colyseus: ColyseusTestServer
  let room: WorldRoom
  let chiron: WorldRoom
  const clients: TestClient[] = []
  const rooms: MeetingRoom[] = findMeetingRooms(worldMap(FIRST).data)
  const ROOM_A = rooms[0]
  const ROOM_B = rooms[1]
  /** Far from every seat and from the meeting rooms. */
  const FAR = { x: 880, y: 500 }
  /** Long enough that nothing ends mid-test. */
  const HOUR = 60

  async function createRooms() {
    room = await colyseus.createRoom<WorldRoom>(roomNameFor(FIRST), {})
    chiron = await colyseus.createRoom<WorldRoom>(roomNameFor(CHIRON), {})
  }

  interface Person {
    client: TestClient
    personId: string
    name: string
  }

  async function connect(name: string, host: WorldRoom = room): Promise<Person> {
    const personId = newPersonId()
    const client = (await colyseus.connectTo(host, { name, personId })) as TestClient
    client.reconnection.enabled = false
    client.onMessage(Message.ROOM_INFO, () => {})
    clients.push(client)
    await client.waitForInitialState()
    return { client, personId, name }
  }

  /** Sends a position and waits until the server has applied it. */
  function moveTo(person: Person, x: number, y: number, host: WorldRoom = room) {
    person.client.send(Message.MOVE, { x, y, dir: 'down', moving: false })
    return waitFor(
      () => {
        const player = host.state.players.get(person.client.sessionId)
        return player?.x === x && player?.y === y
      },
      1_000,
      `the server moves "${person.name}" to (${x}, ${y})`,
    )
  }

  const playerOf = (person: Person, host: WorldRoom = room) =>
    host.state.players.get(person.client.sessionId)!

  /** The refusals the server sent this client, in order. */
  function watchErrors(person: Person): MeetingErrorPayload[] {
    const seen: MeetingErrorPayload[] = []
    person.client.onMessage(Message.MEETING_ERROR, (error) => seen.push(error))
    return seen
  }

  function watchEndings(person: Person): MeetingEndedPayload[] {
    const seen: MeetingEndedPayload[] = []
    person.client.onMessage(Message.MEETING_ENDED, (ended) => seen.push(ended))
    return seen
  }

  function watchChat(person: Person): ChatMessagePayload[] {
    const seen: ChatMessagePayload[] = []
    person.client.onMessage(Message.CHAT_MESSAGE, (message) => seen.push(message))
    return seen
  }

  /** Schedules a meeting and waits until it is in the server's state. */
  async function schedule(
    organiser: Person,
    draft: Partial<MeetingSchedulePayload> & { title: string },
    host: WorldRoom = room,
  ) {
    const before = new Set(host.state.meetings.keys())
    const payload: MeetingSchedulePayload = {
      title: draft.title,
      startsAt: draft.startsAt ?? Date.now() + 60_000,
      minutes: draft.minutes ?? HOUR,
      worldId: draft.worldId ?? FIRST,
      room: draft.room ?? ROOM_A.name,
      invited: draft.invited ?? [],
    }
    organiser.client.send(Message.MEETING_SCHEDULE, payload)
    await waitFor(
      () => [...host.state.meetings.keys()].some((id) => !before.has(id)),
      1_000,
      `the meeting "${draft.title}" is scheduled`,
    )
    return [...host.state.meetings.values()].find((meeting) => meeting.title === draft.title)!
  }

  /** Enters a meeting and waits until the server has placed the person. */
  async function enter(person: Person, meetingId: string, host: WorldRoom = room) {
    person.client.send(Message.MEETING_ENTER, { meetingId })
    await waitFor(
      () => playerOf(person, host).meetingId === meetingId,
      1_000,
      `"${person.name}" enters the meeting`,
    )
  }

  async function leaveQuietly(client: TestClient) {
    await Promise.race([
      client.leave(true).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])
  }

  beforeAll(async () => {
    colyseus = await boot(app)
  })

  afterAll(async () => {
    await colyseus.shutdown()
  })

  beforeEach(async () => {
    // The book is the whole office's, and it outlives a room: each test starts
    // from an empty one, exactly as a restarted server would.
    meetings.reset()
    await createRooms()
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) await leaveQuietly(client)
    meetings.reset()
  })

  // --- Scheduling ----------------------------------------------------------

  describe('scheduling', () => {
    it('puts the meeting in front of everybody, including whoever arrives later', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      const startsAt = Date.now() + 10 * 60_000

      await schedule(dami, { title: 'Weekly', startsAt, minutes: 30, invited: [ana.personId] })

      // Everyone already in the office, within the patch.
      for (const person of [dami, ana]) {
        await waitFor(
          () => person.client.state.meetings.size === 1,
          1_000,
          `"${person.name}" sees the meeting`,
        )
        const meeting = [...person.client.state.meetings.values()][0]
        expect(meeting.title).toBe('Weekly')
        expect(meeting.room).toBe(ROOM_A.name)
        expect(meeting.startsAt).toBe(startsAt)
        expect(meeting.endsAt).toBe(startsAt + 30 * 60_000)
        expect(meeting.organiserName).toBe('Dami')
        expect([...meeting.invited].map((p) => p.name).sort()).toEqual(['Ana', 'Dami'])
        expect(meeting.participants.length).toBe(0)
      }

      // And someone who joins afterwards, from the initial state.
      const late = await connect('Late')
      expect(late.client.state.meetings.size).toBe(1)
      expect([...late.client.state.meetings.values()][0].title).toBe('Weekly')
    })

    it('a meeting is listed in every world, not only the one its room is in', async () => {
      const dami = await connect('Dami')
      await schedule(dami, { title: 'Weekly' })

      const remote = await connect('Remote', chiron)
      expect(remote.client.state.meetings.size).toBe(1)
      expect([...remote.client.state.meetings.values()][0].room).toBe(ROOM_A.name)
    })

    it('the rooms on offer come off the map, not out of a list in code', async () => {
      const dami = await connect('Dami')
      const offered = [...dami.client.state.meetingRooms].map((r) => `${r.worldId}/${r.name}`)
      expect(offered).toEqual(rooms.map((r) => `${FIRST}/${r.name}`))
      expect([...dami.client.state.meetingRooms][0].seats).toBe(ROOM_A.seats.length)
    })

    it('refuses a room already booked at that time, and names what is in the way', async () => {
      const dami = await connect('Dami')
      const errors = watchErrors(dami)
      const startsAt = Date.now() + 10 * 60_000
      const weekly = await schedule(dami, { title: 'Weekly', startsAt, minutes: 30 })

      // Overlapping, same room: refused, with the meeting in the way named.
      dami.client.send(Message.MEETING_SCHEDULE, {
        title: 'Retro',
        startsAt: startsAt + 10 * 60_000,
        minutes: 30,
        worldId: FIRST,
        room: ROOM_A.name,
        invited: [],
      })
      await waitFor(() => errors.length === 1, 1_000, 'the conflict comes back')
      expect(errors[0].reason).toBe('room_conflict')
      expect(errors[0].conflict).toEqual({
        title: 'Weekly',
        startsAt: weekly.startsAt,
        endsAt: weekly.endsAt,
      })
      expect(room.state.meetings.size).toBe(1)

      // The same hour in another room is nobody's business.
      await schedule(dami, {
        title: 'Retro',
        startsAt: startsAt + 10 * 60_000,
        minutes: 30,
        room: ROOM_B.name,
      })
      expect(room.state.meetings.size).toBe(2)

      // Back to back in the same room is not a conflict either.
      await schedule(dami, { title: 'After', startsAt: weekly.endsAt, minutes: 30 })
      expect(room.state.meetings.size).toBe(3)
    })

    it.each([
      ['a start time already gone', { startsAt: Date.now() - 60_000 }, 'start_past'],
      ['an empty title', { title: '   ' }, 'title_empty'],
      ['a title of invisible characters', { title: '​​' }, 'title_empty'],
      ['no duration at all', { minutes: 0 }, 'duration_out_of_range'],
      ['a room that does not exist', { room: 'The Moon' }, 'unknown_room'],
    ])('refuses %s', async (_what, override, reason) => {
      const dami = await connect('Dami')
      const errors = watchErrors(dami)
      dami.client.send(Message.MEETING_SCHEDULE, {
        title: 'Weekly',
        startsAt: Date.now() + 60_000,
        minutes: 30,
        worldId: FIRST,
        room: ROOM_A.name,
        invited: [],
        ...override,
      })
      await waitFor(() => errors.length === 1, 1_000, 'the refusal comes back')
      expect(errors[0].reason).toBe(reason)
      expect(room.state.meetings.size).toBe(0)
    })

    it('only the organiser can cancel, and the meeting leaves every list', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      const errors = watchErrors(ana)
      const weekly = await schedule(dami, {
        title: 'Weekly',
        startsAt: Date.now() + 1_000,
        invited: [ana.personId],
      })
      await enter(ana, weekly.id)
      const endings = watchEndings(ana)

      ana.client.send(Message.MEETING_CANCEL, { meetingId: weekly.id })
      await waitFor(() => errors.length === 1, 1_000, 'a non-organiser is refused')
      expect(errors[0].reason).toBe('not_organiser')
      expect(room.state.meetings.size).toBe(1)

      dami.client.send(Message.MEETING_CANCEL, { meetingId: weekly.id })
      await waitFor(() => room.state.meetings.size === 0, 1_000, 'the meeting is cancelled')
      await waitFor(() => endings.length === 1, 1_000, 'the participant is told')
      expect(endings[0]).toEqual({ meetingId: weekly.id, title: 'Weekly', reason: 'cancelled' })
      // Released: out of the meeting, and the chair is free again.
      expect(playerOf(ana).meetingId).toBe('')
      await waitFor(
        () => ana.client.state.meetings.size === 0,
        1_000,
        'it leaves the client list too',
      )
    })
  })

  // --- Entering ------------------------------------------------------------

  describe('entering', () => {
    /** A meeting that is open right now, with everybody invited. */
    async function openMeeting(organiser: Person, invited: Person[], room_ = ROOM_A) {
      return schedule(organiser, {
        title: 'Weekly',
        startsAt: Date.now() + 1_000,
        minutes: HOUR,
        room: room_.name,
        invited: invited.map((person) => person.personId),
      })
    }

    it('seats you at the table in one step, facing it, and the seat is taken for everyone', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      await moveTo(dami, FAR.x, FAR.y)
      const weekly = await openMeeting(dami, [ana])

      await enter(dami, weekly.id)

      const me = playerOf(dami)
      const seat = ROOM_A.seats.find((s) => s.name === me.seatId)!
      expect(seat, 'seated at a seat of this room').toBeDefined()
      expect({ x: me.x, y: me.y }).toEqual(seatAnchor(seat))
      expect(me.dir).toBe(seat.dir)
      expect(rectContains(ROOM_A, me.x, me.y)).toBe(true)
      expect(me.moving).toBe(false)

      // Every other client sees the chair as taken.
      await waitFor(
        () => ana.client.state.players.get(dami.client.sessionId)?.seatId === seat.name,
        1_000,
        'the seat is taken for everyone',
      )
      // And the meeting lists them as having arrived.
      await waitFor(
        () => [...ana.client.state.meetings.values()][0].participants.length === 1,
        1_000,
        'the participant list updates',
      )
      expect([...[...ana.client.state.meetings.values()][0].participants][0].name).toBe('Dami')
    })

    it('reads as being in that meeting, and is never swept to away', async () => {
      const dami = await connect('Dami')
      const weekly = await openMeeting(dami, [])
      await enter(dami, weekly.id)

      const me = playerOf(dami)
      expect(playerStatus(me)).toBe('meeting')
      expect(me.meetingId).toBe(weekly.id)

      // AWAY_AFTER_SECONDS is 1 in the test config: more than long enough.
      await new Promise((resolve) => setTimeout(resolve, 1_800))
      expect(playerOf(dami).away, 'a participant was swept to away').toBe(false)
      expect(playerStatus(playerOf(dami))).toBe('meeting')
    })

    it('turns away anybody the organiser did not invite', async () => {
      const dami = await connect('Dami')
      const nosy = await connect('Nosy')
      const errors = watchErrors(nosy)
      const weekly = await openMeeting(dami, [])

      nosy.client.send(Message.MEETING_ENTER, { meetingId: weekly.id })
      await waitFor(() => errors.length === 1, 1_000, 'the refusal comes back')
      expect(errors[0].reason).toBe('not_invited')
      expect(playerOf(nosy).meetingId).toBe('')
      expect(playerOf(nosy).seatId).toBe('')
    })

    it('is not open before its entry window, nor after it is over', async () => {
      const dami = await connect('Dami')
      const errors = watchErrors(dami)
      const later = await schedule(dami, {
        title: 'Later',
        startsAt: Date.now() + MEETING_ENTRY_WINDOW_MS + 60_000,
      })

      dami.client.send(Message.MEETING_ENTER, { meetingId: later.id })
      await waitFor(() => errors.length === 1, 1_000, 'too early comes back')
      expect(errors[0].reason).toBe('too_early')
      expect(playerOf(dami).meetingId).toBe('')

      // A meeting that is not there any more (it ended, or never existed).
      dami.client.send(Message.MEETING_ENTER, { meetingId: 'mt-nope' })
      await waitFor(() => errors.length === 2, 1_000, 'the second refusal comes back')
      expect(errors[1].reason).toBe('not_found')
    })

    it('a meeting in another world is not entered from here', async () => {
      const dami = await connect('Dami')
      const remote = await connect('Remote', chiron)
      const weekly = await openMeeting(dami, [remote])
      const errors = watchErrors(remote)

      remote.client.send(Message.MEETING_ENTER, { meetingId: weekly.id })
      await waitFor(() => errors.length === 1, 1_000, 'the refusal comes back')
      expect(errors[0].reason).toBe('travel_failed')
      expect(playerOf(remote, chiron).meetingId).toBe('')
    })

    it('arrives already seated when the trip is what brought them', async () => {
      const dami = await connect('Dami')
      const traveller = await connect('Traveller')
      const weekly = await openMeeting(dami, [traveller])

      // What the client does on crossing over: join the destination naming the
      // meeting, and be at the table on arrival rather than at the entrance.
      const personId = traveller.personId
      await leaveQuietly(traveller.client)
      clients.splice(clients.indexOf(traveller.client), 1)
      await waitFor(() => room.state.players.size === 1, 1_000, 'the traveller left')

      const arrived = (await colyseus.connectTo(room, {
        name: 'Traveller',
        personId,
        meeting: weekly.id,
      })) as TestClient
      arrived.reconnection.enabled = false
      arrived.onMessage(Message.ROOM_INFO, () => {})
      clients.push(arrived)
      await arrived.waitForInitialState()

      const me = room.state.players.get(arrived.sessionId)!
      expect(me.meetingId).toBe(weekly.id)
      expect(ROOM_A.seats.some((seat) => seat.name === me.seatId)).toBe(true)
      expect(rectContains(ROOM_A, me.x, me.y)).toBe(true)
    })

    it('with every chair taken you get in standing, inside the room and off the chairs', async () => {
      const dami = await connect('Dami')
      const crowd: Person[] = []
      for (let i = 0; i < ROOM_A.seats.length; i++) crowd.push(await connect(`Seat ${i}`))
      const standing = await connect('Standing')
      const weekly = await openMeeting(dami, [...crowd, standing])

      for (const person of crowd) await enter(person, weekly.id)
      expect(ROOM_A.seats.every((seat) => room.state.players.size > 0 && seatTaken(seat.name)))
      await enter(standing, weekly.id)

      const me = playerOf(standing)
      expect(me.seatId, 'stood, not sat').toBe('')
      expect(me.meetingId, 'in the meeting all the same').toBe(weekly.id)
      expect(rectContains(ROOM_A, me.x, me.y), 'inside the room').toBe(true)
      expect(
        ROOM_A.seats.some((seat) => rectContains(seat, me.x, me.y)),
        'not standing on a chair',
      ).toBe(false)
      // And in the same conversation as everyone sitting down.
      expect(me.bubbleId).toBe(playerOf(crowd[0]).bubbleId)
      expect(me.bubbleId).not.toBe('')

      // A chair frees up: they can take it like anybody else.
      const freed = playerOf(crowd[0]).seatId
      crowd[0].client.send(Message.MEETING_LEAVE, {})
      await waitFor(() => !seatTaken(freed), 1_000, 'the chair is free again')
      standing.client.send(Message.SIT, { seat: freed })
      await waitFor(() => playerOf(standing).seatId === freed, 1_000, 'they sit down in it')
      expect(playerOf(standing).meetingId, 'still in the meeting').toBe(weekly.id)
    })

    function seatTaken(seatId: string): boolean {
      let taken = false
      room.state.players.forEach((player) => {
        if (player.seatId === seatId) taken = true
      })
      return taken
    }
  })

  // --- The conversation ----------------------------------------------------

  describe('the meeting conversation', () => {
    async function meetingWith(...people: Person[]) {
      const organiser = people[0]
      const weekly = await schedule(organiser, {
        title: 'Weekly',
        startsAt: Date.now() + 1_000,
        minutes: HOUR,
        invited: people.map((person) => person.personId),
      })
      for (const person of people) await enter(person, weekly.id)
      return weekly
    }

    it('holds everyone who entered, however wide the table, and nobody else', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      // Standing in the doorway of the room: close enough to be in a bubble
      // with somebody at the table, if meetings worked by distance.
      const passer = await connect('Passer')
      const weekly = await meetingWith(dami, ana)

      // Across the table from each other: entering fills the chairs in the
      // map's order, so they are put in touch first and moved apart after,
      // which is the arrangement the meeting has to survive.
      const here = seatAnchor(ROOM_A.seats.find((s) => s.name === playerOf(dami).seatId)!)
      const across = [...ROOM_A.seats]
        .filter((seat) => seat.name !== playerOf(dami).seatId)
        .sort((a, b) => far(b) - far(a))[0]
      ana.client.send(Message.SIT, { seat: across.name })
      await waitFor(() => playerOf(ana).seatId === across.name, 1_000, 'Ana moves across the table')
      function far(seat: (typeof ROOM_A.seats)[number]) {
        const anchor = seatAnchor(seat)
        return Math.hypot(anchor.x - here.x, anchor.y - here.y)
      }

      const damiPlayer = playerOf(dami)
      const anaPlayer = playerOf(ana)
      expect(damiPlayer.bubbleId).not.toBe('')
      expect(damiPlayer.bubbleId).toBe(anaPlayer.bubbleId)
      const bubble = room.state.bubbles.get(damiPlayer.bubbleId)!
      expect(bubble.meetingId).toBe(weekly.id)
      // Farther apart than a conversation normally carries.
      expect(Math.hypot(damiPlayer.x - anaPlayer.x, damiPlayer.y - anaPlayer.y)).toBeGreaterThan(
        room.state.bubbleRadius,
      )

      await moveTo(passer, damiPlayer.x + 8, damiPlayer.y + 8)
      expect(playerOf(passer).bubbleId, 'walking past joined the meeting').toBe('')
      expect([...bubble.members].sort()).toEqual(
        [dami.client.sessionId, ana.client.sessionId].sort(),
      )
    })

    it('reaches exactly the participants', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      const passer = await connect('Passer')
      await meetingWith(dami, ana)
      const heardByAna = watchChat(ana)
      const heardByPasser = watchChat(passer)
      await moveTo(passer, playerOf(dami).x + 8, playerOf(dami).y + 8)

      dami.client.send(Message.CHAT_SEND, { id: 'm1', text: 'shall we start?' })
      await waitFor(() => heardByAna.length === 1, 1_000, 'the other participant hears it')
      expect(heardByAna[0].text).toBe('shall we start?')
      expect(heardByPasser, 'somebody outside the meeting heard it').toHaveLength(0)
    })

    it('standing up gives the chair back and drops you out of the conversation', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      const weekly = await meetingWith(dami, ana)
      const seat = playerOf(dami).seatId
      const bubbleId = playerOf(dami).bubbleId
      const heardByDami = watchChat(dami)

      dami.client.send(Message.STAND, {})
      await waitFor(() => playerOf(dami).seatId === '', 1_000, 'they stand up')

      expect(playerOf(dami).meetingId, 'still listed as in the meeting').toBe('')
      expect(playerOf(dami).bubbleId, 'still in the meeting conversation').toBe('')
      expect([...room.state.bubbles.get(bubbleId)!.members]).toEqual([ana.client.sessionId])
      await waitFor(
        () => [...room.state.meetings.get(weekly.id)!.participants].length === 1,
        1_000,
        'they leave the participant list',
      )
      // The chair is free for the next person.
      let taken = false
      room.state.players.forEach((player) => {
        if (player.seatId === seat) taken = true
      })
      expect(taken).toBe(false)

      // The meeting's chat no longer reaches them...
      ana.client.send(Message.CHAT_SEND, { id: 'm2', text: 'still here?' })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(heardByDami).toHaveLength(0)

      // ...and walking up to somebody opens an ordinary bubble again.
      const other = await connect('Other')
      await moveTo(other, FAR.x, FAR.y)
      await moveTo(dami, FAR.x + 8, FAR.y)
      await waitFor(
        () =>
          playerOf(dami).bubbleId !== '' && playerOf(dami).bubbleId === playerOf(other).bubbleId,
        1_000,
        'an ordinary bubble forms again',
      )
      expect(room.state.bubbles.get(playerOf(dami).bubbleId)!.meetingId).toBe('')
    })

    it('walking off the chair leaves the meeting too', async () => {
      const dami = await connect('Dami')
      const weekly = await meetingWith(dami)
      await moveTo(dami, FAR.x, FAR.y)
      expect(playerOf(dami).seatId).toBe('')
      expect(playerOf(dami).meetingId).toBe('')
      expect([...room.state.meetings.get(weekly.id)!.participants]).toHaveLength(0)
    })

    it('closing the tab frees the chair and drops the participant; the rest carry on', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      const zoe = await connect('Zoe')
      const weekly = await meetingWith(dami, ana, zoe)
      const seat = playerOf(ana).seatId
      const heardByZoe = watchChat(zoe)

      await leaveQuietly(ana.client)
      clients.splice(clients.indexOf(ana.client), 1)
      await waitFor(
        () => [...room.state.meetings.get(weekly.id)!.participants].length === 2,
        2_000,
        'they leave the participant list',
      )
      let taken = false
      room.state.players.forEach((player) => {
        if (player.seatId === seat) taken = true
      })
      expect(taken, 'the chair was left taken').toBe(false)

      dami.client.send(Message.CHAT_SEND, { id: 'm3', text: 'carrying on' })
      await waitFor(() => heardByZoe.length === 1, 1_000, 'the meeting carries on for the others')
      expect(heardByZoe[0].text).toBe('carrying on')
    })

    it('when the end time passes it is over for everyone', async () => {
      const dami = await connect('Dami')
      const ana = await connect('Ana')
      const endings = watchEndings(dami)
      // Opens now and is over a moment later: the entry window is five minutes
      // wide, so a meeting starting in a second can be walked into at once.
      const startsAt = Date.now() + 500
      const weekly = await schedule(dami, {
        title: 'Weekly',
        startsAt,
        minutes: 5,
        invited: [dami.personId, ana.personId],
      })
      await enter(dami, weekly.id)
      await enter(ana, weekly.id)
      const bubbleId = playerOf(dami).bubbleId
      const seat = playerOf(dami).seatId

      // Its end is the wall clock's business, so the end is brought forward
      // rather than the test waiting five minutes for it.
      meetings.get(weekly.id)!.endsAt = Date.now() - 1

      await waitFor(() => room.state.meetings.size === 0, 3_000, 'the meeting ends')
      await waitFor(() => endings.length === 1, 1_000, 'the participants are told')
      expect(endings[0].reason).toBe('ended')
      expect(room.state.bubbles.has(bubbleId), 'the conversation survived the meeting').toBe(false)
      // Still sitting, so simply focused at that chair now.
      const me = playerOf(dami)
      expect(me.meetingId).toBe('')
      expect(me.seatId).toBe(seat)
      expect(playerStatus(me)).toBe('focused')
      expect(me.bubbleId).toBe('')
      await waitFor(
        () => dami.client.state.meetings.size === 0,
        1_000,
        'it leaves every client list',
      )
    })
  })

  it('a restarted server has no meetings and no error', async () => {
    const dami = await connect('Dami')
    await schedule(dami, { title: 'Weekly' })
    expect(room.state.meetings.size).toBe(1)

    // What a restart does to a book that only ever lived in memory.
    meetings.reset()
    await waitFor(() => room.state.meetings.size === 0, 1_000, 'the list empties')

    const after = await connect('After')
    expect(after.client.state.meetings.size).toBe(0)
    expect([...after.client.state.meetingRooms].length).toBe(rooms.length)
  })
})
