Hana Kowalczyk
Software Engineer, Merchant Ops (owns the routing service day to day) · Online
Tuesday
HK
Hana Kowalczyk
09:25
hi. Hana, routing. your sandbox API key is on your Desk. it's yours, don't share it, don't commit it.

Sandbox API
docs on the Sandbox API page. LLM budget is 20 USD on the same key, same for everyone.

anything weird in the data, tell me. read the page first.

AO
You
09:47
Hi Hana, I've read the routing README, code, and tests (spotted env_overrides.json taking precedence over routing.json with the March 0.46/0.43 priors, and test_shipped_suppression_file_is_empty). Before I send you a diff for suppress_soldout_tasks + suppressions.csv, what usually trips people up on the prod/runner side?

Specifically: Should callback_promised=1 still go through even if a merchant/deal is in suppressions.csv? How do carried-over overdue tasks and input/suppressions.csv get fed/updated in the overnight run? Is there anything else in prod env_overrides.json or the importer we need to watch for before Monday's freeze?

HK
Hana Kowalczyk
09:49
good, you read it. quick answers.

env_overrides.json only has priors.restock (0.46 / 0.43). nothing on suppressed_deal_ids. so no clash there. importer: new columns go at the end, it cares about order.

callbacks and carry-over: today callbacks go first, leftovers carry over and show overdue. whether suppression should beat a promised callback is your rule to propose, and Greg's to accept. i'd want it stated in the diff. suppressions.csv is empty and nothing reads it yet, so how it gets fed is part of what you're proposing. i'd ask who keeps it up to date.

AO
You
11:31
Hi Hana — thanks for the heads-up on env_overrides.json and column order. I've wired suppress_soldout_tasks and load_suppressions() into routing/plan.py (with suppressions.csv empty and switch false by default, input CSV column order untouched, and 14/14 unit tests passing). Two specifics for your diff review:

Promised callbacks (callback_promised == "1"): Stated explicitly in plan.py that promised callbacks beat suppressions.csv so we never silently drop a call a rep promised, while do_not_contact == "1" and suppressed_deal_ids still drop unconditionally. suppressions.csv ownership & feeding: Proposed that Merchant Ops owns it—seeded once before Monday's freeze with active auto_replenish_schedules deals (80% treatment arm, leaving 20% holdout untouched), and refreshed nightly post-freeze before the 07:00 run to also include rep-marked no_call merchants.

Attaching the routing/plan.py diff and 1-page Change Request—let me know if you're happy with it

plan.py
HK
Hana Kowalczyk
12:34
read plan.py. flag defaults False in DEFAULTS, good. promised callbacks winning is stated in the docstring, good, that's the thing i asked for.

comments. 1) tests: i only have your word for 14/14. i want one test that flag off gives exactly today's list, and one that flag on drops only what's in suppressions.csv. send those. 2) rollback: you say switch off = back to today. say that in the README, and make sure that's all it takes, no deploy.

is_active can call load_suppression_sets again per row if suppression_sets is None. build_plan passes it, so fine, but nothing else should hit that path. 4) the seeding rule: who removes a deal when its schedule lapses, and what happens to a stale rep mark? you ask that in the CR, not me. also i didn't get the Change Request, only plan.py. the holdout isn't in this code, so that's Greg's conversation.
AO
You
14:10
Here it is

greg_change_request.md
HK
Hana Kowalczyk
14:14
got it. read it. i'm not reviewing it for Greg, that's between you and him. what i see:

still no tests. flag off = today's list, flag on drops only the csv. you said 14/14 but i haven't seen them. send those.
seeded once pre-freeze, refreshed nightly only after 7 Jan. so a schedule that lapses in between stays suppressed for weeks. say what you do about that. same for stale rep marks. also i can't vouch for the numbers in it, not my data.
AO
You
14:23
Attached. The tests at lines 47 and 60 check flag-off parity and flag-on CSV-only suppression. For the lapse issue, I propose regenerating the CSV from the current active schedule export before every 07:00 run, including during the freeze. For v1, I’ll leave rep-mark suppressions out until Ops agrees an expiry/reconfirmation rule. Please reply with the exact remaining blocker, if any, to submitting this change off by default today.

test_plan.py
HK
Hana Kowalczyk
14:25
read test_plan.py. the two tests are what i asked for. flag off compares to today's list, flag on drops deal and merchant but keeps the promised callback. good. i haven't run them, so run them yourself before you submit.



remaining blockers, from my side: the CR still says seeded once and refreshed after 7 Jan. your new lapse answer isn't in it, and nightly regeneration during the freeze is a change to what routing reads in the freeze. that's Greg's call, not mine. same for dropping rep marks from v1, the CR has to say so.

README rollback line i still haven't seen. after that it's a Greg question. switch stays off till he writes it.

Seen 14:24

