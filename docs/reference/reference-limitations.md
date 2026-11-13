# Reference limitations

1. **Chat-only account.** `/agent/*` (the Support ticket workspace) redirects to `/chat/agent`. Tickets, views,
   customers, organizations, macros, SLA, the Help Center and Admin Center could not be inspected. They are built
   from official docs and the project spec and are labelled D/P.
2. **Plan-gated pages.** Analytics, Monitor, Roles, Goals, Routing › Skills, private apps, parts of Email reports and
   Operating hours show upgrade prompts on the Team plan. We saw the prompts but not the feature UIs.
3. **No live chat during the audit.** The agent was Invisible, with 0 requests and no active visitors. The live chat
   serving panel, the transfer dialog and the visual visitor map were not observed. We did not go Online and did not
   simulate a visitor, because both change state in the real account.
4. **Add agent** hit the plan limit (1 of 1), so its form fields were not observed.
5. **No saves.** Every form was opened read-only and then cancelled or discarded. A "Leave site?" prompt
   appeared after tab navigation, and we discarded it. Nothing was persisted.
6. **Real data.** History (about 1,194 pages), Banned (280 entries) and Shortcuts (82) contain real customer and business
   content. None of it was exported. Screenshots stay local and are gitignored. Seed data in our app is synthetic.
7. **Branding.** The product name, logo, illustrations and copy in our app are original. Only layout metrics and
   interaction patterns are reproduced.
8. **Visual parity.** Screenshots are 0.6–0.7× JPEGs, which is good enough for layout comparison but not for
   pixel-perfect diffing.
