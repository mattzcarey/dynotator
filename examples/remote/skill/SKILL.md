---
name: dynotator
description: Put local changes, a plan or any files up for human review in the browser with the dynotator CLI, then read the reviewer's feedback. Use when the user asks for a Dynotator URL or link, says "dynotator this", or wants to review or annotate your work in the browser.
---

# Dynotator

`dynotator` puts files up on a review page. A person reads them in the browser, annotates lines
and sends feedback or approves. You read that back and act on it.

It needs `DYNOTATOR_URL` in the environment. If a command says it is unset, ask the user for
their Dynotator URL. The first call may open a browser for the user to sign in.

## Create a review

Pick the form that matches what the user asked for.

```sh
dynotator review                        # uncommitted changes in this repo, against HEAD
dynotator review --base main            # everything this branch changes against main
dynotator review PLAN.md                # just these files or directories, no diff
dynotator review --base main PLAN.md    # the changes, plus PLAN.md as context
```

Add `--title "..."` to name it and `--open PATH` to choose the file shown first.

The first line of output is the URL. Give it to the user exactly as printed. If you wrote a plan
or notes only in the conversation, save them to a file first and review that file.

## Read the feedback

```sh
dynotator events --wait 600
```

This waits up to ten minutes and prints events you have not seen yet. `feedback` and `approved`
come from the reviewer; the text under each is markdown naming the file, the lines and what they
want. "No new events." means the time ran out: run it again, or ask the user if they are done.

Do not wait unless the user wants you to act on the feedback. If they only asked for a link,
give them the link and stop.

## Act on it

1. Make the changes the feedback asks for.
2. Run `dynotator revise`. It puts the files as they are now up as the next version at the same
   URL, and the reviewer sees what changed.
3. Run `dynotator events --wait 600` again.

Feedback sent after an approval withdraws it, so keep reading until the latest reviewer event on
the current version is `approved`, or the user tells you to stop. Then run `dynotator close`.

Each command acts on the last review created from the current directory. Pass a review id as the
first argument to act on another one.
