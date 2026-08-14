# Contextboard

## PR

When the user asks for filing a PR, don't make a draft. The PR title should describe the problem it solves, and the description should contain the initial prompt of what happened and the final solution. You should not include implementation detail in the description.

## Environment

When the user isn't explicitely ask, assume the dev server is already on. Don't spawn long lived process as it's hard for the user to manage.

## Writing cards

If a task will end in cards on the user's own boards, read
`skills/contextboard/card-style.md` **before starting the research**, not before
writing. It governs what to keep while reading, so loading it at drafting time
is too late. `skills/contextboard/SKILL.md` is the API; that file is the voice,
the joints between cards, and the layout conventions.

## Code & Style

Clean, precise and concise code is always preferred. Find clever solution rather then brute force. Don't write excessive test, only focus on the most important ones. Diligence is a good virtue but burns too many tokens, so be smart about your work. For example, don't write Python-style Typescript code (e.g. one liner function to enforce type), in favor of the one that Matt Pocock would like.