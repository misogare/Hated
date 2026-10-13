# Security

HateD holds personal things: names, birthdays, photos and conversations. If
you find a way to reach any of it that you shouldn't, please tell us privately
rather than in a public issue.

## Reporting a vulnerability

Use GitHub's private reporting: the repository's **Security** tab, then
**Report a vulnerability**
([direct link](https://github.com/misogare/Hated/security/advisories/new)).
Say what you found, how to reproduce it, and what it exposes. Only the
maintainers see the report while it's being fixed.

Please test against your own copy (see "Run it yourself" in the README), never
against other people's accounts or data. The web demo runs entirely in your
browser, with no server behind it, so there is nothing of anyone else's to
reach there.

## What's in scope

The API, the database layer and the app in this repository. Of particular
interest: seeing a match's photos in full before both have said hello,
reading a conversation you're not in, signing in as someone else, getting
past the institution allowlist, and anything that reveals who said hello or
who passed.

## Supported versions

Only the latest commit on `main`.
