/**
 * The mark that says "this one is me", next to one's own name.
 *
 * It appears in the three places a person is named - the people list, the
 * bubble's members and the chat - and it is the same element in all three, so
 * one's own row is found the same way wherever the eye happens to land.
 */
export function youTag(): HTMLSpanElement {
  const you = document.createElement('span')
  you.className = 'you-tag'
  you.textContent = 'You'
  return you
}
