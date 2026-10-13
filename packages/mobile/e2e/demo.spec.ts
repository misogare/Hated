import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The web demo as a visitor meets it: sign in, onboarding, the round, the
 * reveal, a hello back and a conversation, then three more rounds: a match who
 * said hello first, one who never does, and how that one closes.
 */

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** A small photo to add, as a picker would hand it over. */
const PHOTO = Buffer.from(
  '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCACWAHgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCsBemAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/Z',
  'base64',
);

/** Set a slider by pressing at a fraction of its track, as a finger would. */
async function slide(page: Page, slider: Locator, fraction: number) {
  const box = await slider.boundingBox();
  if (box === null) throw new Error('The slider is not on screen');
  await page.mouse.click(box.x + 14 + (box.width - 28) * fraction, box.y + box.height / 2);
}

async function skipToRound(page: Page) {
  await page.getByRole('button', { name: /Demo: skip to/ }).click();
  await expect(page.getByText('Your match is here')).toBeVisible();
}

async function openMatch(page: Page) {
  await page.getByRole('link', { name: /^Your match:/ }).click();
  await button(page, 'Break the seal').click();
  await button(page, 'Say hello').click();
}

test("a visitor's first weeks", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await test.step('signs in with the code the demo shows', async () => {
    await page.goto('./');
    await expect(page.getByText('A demo with made-up people.', { exact: false })).toBeVisible({ timeout: 60_000 });
    await button(page, 'Get started').click();
    await button(page, 'Verify my email').click();
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('you@demo.edu');
    await button(page, 'Send my code').click();
    await expect(page.getByText('Your code is 123456', { exact: false })).toBeVisible();
    const code = page.getByRole('textbox', { name: 'Verification code', exact: true });
    await code.fill('111111');
    await expect(page.getByText("That code didn't match.", { exact: false })).toBeVisible();
    await code.fill('123456');
  });

  await test.step('onboards: about, the questions, what matters, photos and words', async () => {
    await expect(page.getByText('A little about you')).toBeVisible();
    await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Sam');
    await page.getByRole('textbox', { name: 'Birthday day' }).fill('14');
    await page.getByRole('textbox', { name: 'Birthday month' }).fill('02');
    await page.getByRole('textbox', { name: 'Birthday year' }).fill('2000');
    await button(page, 'Woman').click();
    await button(page, 'Everyone').click();
    await button(page, 'Continue').click();

    for (const value of [0.72, 0.45, 0.62, 0.9, 0.74]) {
      await expect(page.getByText(/Question \d of 6/)).toBeVisible();
      await slide(page, page.getByRole('slider'), value);
      await button(page, 'Next').click();
    }
    await expect(page.getByText('What does an ideal weekend look like?')).toBeVisible();
    await button(page, 'Culture').click();
    await button(page, "Next: what you're hoping for").click();

    await expect(page.getByText('What are you hoping for?')).toBeVisible();
    await page.getByRole('radiogroup', { name: 'How much humor matters' }).getByText('Important', { exact: true }).click();
    await slide(page, page.getByRole('slider', { name: "Humor: what you're hoping for" }), 0.85);
    await button(page, 'Next: photos and words').click();

    await expect(page.getByText('2 of 6')).toBeVisible();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add a photo' }).first().click()]);
    await chooser.setFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
    await expect(page.getByText('3 of 6')).toBeVisible();
    await expect(page.getByText('In review', { exact: true })).toBeVisible();
    await expect(page.getByText('Photos marked "In review" are checked', { exact: false })).toBeVisible();
    await page.getByRole('textbox', { name: 'A line about you', exact: true }).fill('Bookshops, long walks and far too much coffee.');
    await page.getByRole('textbox', { name: 'A perfect Sunday', exact: true }).fill('A slow breakfast, a long walk, and a film I can quote.');
    await button(page, 'Save and finish').click();
    await expect(page.getByText("You're in.")).toBeVisible();
    await button(page, 'Go to home').click();
    await expect(page.getByText(/round closes in/)).toBeVisible();
  });

  await test.step('meets Maya, who says hello back, and they talk', async () => {
    await skipToRound(page);
    await page.getByRole('link', { name: /^Your match:/ }).click();
    await button(page, 'Break the seal').click();
    await expect(page.getByText('Why you two')).toBeVisible();
    await expect(page.getByText('Their humor is what you hoped for')).toBeVisible();
    await button(page, 'Say hello').click();
    await expect(page.getByText(/Waiting for Maya · .* left/).last()).toBeVisible();
    await expect(page.getByText('You both said hello.', { exact: true }).filter({ visible: true })).toBeVisible();

    await expect(page.getByText('Not sure how to start?')).toBeVisible();
    await page.getByRole('button', { name: /perfect Sunday sounds good/ }).click();
    await button(page, 'Send').click();
    await expect(page.getByLabel('Maya is typing')).toBeVisible();
    await expect(page.getByText('Glad you said hello.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Maya is typing')).toHaveCount(0);
    await page.getByRole('textbox', { name: /^Message to Maya/ }).fill('Same here! The envelope was a nice touch.');
    await button(page, 'Send').click();
    await expect(page.getByText("what's the last book you couldn't put down?", { exact: false })).toBeVisible();
  });

  await test.step('next week, says how it went with Maya, and Theo has already said hello', async () => {
    await page.goto('home');
    await skipToRound(page);
    await expect(page.getByText('How did it go with Maya?')).toBeVisible();
    await button(page, 'Really well').click();
    await expect(page.getByText('Thanks. That helps choose better matches.')).toBeVisible();
    await openMatch(page);
    await expect(page.getByText('Not sure how to start?')).toBeVisible();
  });

  await test.step('the week after, Inés never says hello, and the match closes', async () => {
    await page.goto('home');
    await expect(page.getByText(/round closes in/)).toBeVisible();
    await expect(page.getByText('How did it go with Maya?')).toHaveCount(0);
    await skipToRound(page);
    await openMatch(page);
    await expect(page.getByText(/Waiting for Inés · 23 h \d+ min left/).last()).toBeVisible();
    await page.waitForTimeout(6500);
    await expect(page.getByText('Not sure how to start?')).toHaveCount(0);

    await page.goto('home');
    await skipToRound(page);
    await page.goto('matches');
    await expect(page.getByText('Closed: the time to say hello ran out')).toBeVisible();
  });

  await test.step('a link into the app survives a reload', async () => {
    await page.reload();
    await expect(page.getByText('Closed: the time to say hello ran out')).toBeVisible({ timeout: 30_000 });
    await page.goto('settings');
    await expect(page.getByText('Demo University')).toBeVisible();
    await expect(page.getByRole('switch', { name: /^Reminders/ })).toBeChecked();
  });

  expect(errors).toEqual([]);
});
