---
"@aomi-labs/deploy": minor
---

Move the Manager client and BFF implementations into the private `@aomi-labs/internal` workspace package. This removes the public Manager client and BFF entry points from Deploy; external consumers using those APIs must remain on 0.10 until migrated. Deploy continues to provide its wire types, errors, activation helpers, and browser launch client.
