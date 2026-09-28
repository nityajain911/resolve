# Demo script (~90 seconds, 1440×900)

Before recording: **Reset demo**, then turn on **Demo mode** (bottom bar steps through the same beats).

**0–10s · Command centre (`/`)**
"Razorpay already has a Receivables Agent that sends reminders and makes calls. This banner is a
*simulated* handoff: ₹1.03 Cr across 46 invoices is still unpaid after that. Resolve doesn't
remind harder — it groups each invoice by what's actually blocking it. One state per invoice."
*(Point at the state cards and the dashed Needs review card.)*

**10–35s · GSTIN blocker (Kesarbagh Foods, SCP-1057)**
"The buyer wrote 'GSTIN galat hai, accounts reject kar raha hai'. The AI reads the Hinglish;
the imported IMS export says Rejected, Incorrect GSTIN, which corroborates it. So Resolve pauses
reminders, routes to Accounts and drafts a correction. It won't issue a tax document itself —
approval required." *(Click Approve correction → Mark corrected invoice issued: follow-up resumes.)*

**35–60s · Cash constraint (Nilgiri Crest, SCP-1049)**
"'₹90K aaj, baaki 15 ke baad.' Resolve extracts ₹90,000 now and ₹1,75,500 remaining, and treats
'after the 15th' as an after-date, not an exact date." *(Review plan.)* "The policy engine, not the
AI, checks it: part payments allowed, above the minimum, within the extension limit, still unpaid.
Review-first, so I approve." *(Approve → Test-mode or Simulated payment link badge → Simulate
payment received ₹90,000.)*

**60–75s · Promise to pay (Vasundhara Home Care, SCP-1061)**
"'Monday tak kar denge', resolved against the message timestamp to Monday 28 Sep. The buyer kept
3 of 3 previous promises, so Resolve waits: no follow-up until Monday." *(Advance demo clock past
deadline.)* "The timer re-checks payment, finds none: promise missed, follow-up resumed. History is
now 3 of 4."

**75–82s · Needs review (Meghdoot Pharma Packs, SCP-1053)**
"'Accounts ne park kiya, PO mismatch.' Paperwork or a quantity dispute? Resolve won't guess. No
buyer message until a person classifies it." *(Click Commercial dispute; recorded as an override
and added to the labelled review set.)*

**82–90s · Impact (`/evaluation`)**
"On this labelled synthetic book, reminder-only would make 14 wrong chases: invoices already paid
or disputed. Resolve blocked 10 of 14. The 4 it missed had no usable signal, like a cash payment.
Cash collected is the pilot metric, Resolve versus a reminder-only holdout, not a number we
simulate."

*(Numbers above are what the code computes for seed 20260921; the screen is the source of truth.)*
