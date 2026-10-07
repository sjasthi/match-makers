[FP1] 9/15/2026
Try to come up with success criteria project.
Do research about 'what is out there in the market'
We also need to emphasize  honesty and proof. How do we weed out the liars from the website?

# Success Critera
- *Research and understand why people go to use those application*
- *Know what architecture we are going to follow for our project*
- *Have dates where the each task shall be done by*
- *Have the project be presentation and convient*
- *Be able to solve multiple problems with simplicity*

# Current Market for Dating Applications
1. Hinge | Focuses on serious relationship by forcing a person to like or make a comment on the profile before proceeding (Creating effort and meaningful)
2. Bumble | Women first, Also offers a choice to finding friends only mode and professional networking.
3. Tinder | Convience, easy for user to use where it can cover multiple area of intent
4. Grindr | Focuses on a specific group of audience.

Core takeaway: In these applications, there are the concept of focusing either on the Broad-audiance of any sex/gender focused or a Niche-audience with specific preference.
This can affect the way someone wants to use your application or not. There isn't one exact applcation that can solve every single preference. So in this case, we would have to decide
what kind we want to focus on. There is also specific ways each application match people, such as Tinder has high volume level of matches vs Hinge where the person has to actually interact with 
someone's profile in order to initiate a conversation (Limiting the amount of likes per day).

# How do we emphasize honesty/proof
- One way to utilize that is allow a limited amount of ways to interact such as hinge, this can allow for a way to weed out the bots prevents spamming.
- Having to verify specific information such as ID/Puzzle/Some sort of biometric check (A way that is not intrusive also)
- Connected accounts from other verfied applications
- Manual confirmation
- Allow other users to manually report and have manual admins review

[FP2] 9/22/2026
### Determine what architecture we want run and what is the tech stack that we will be utilizing.
    [Client Application] -> [API Gateway / Reverse Proxy (Nginx)]  
    [API Gateway / Reverse Proxy (Nginx)] -> [Backend Application]  
    
    #Inside backend contains  
    [Auth] [Matching and Feed engine] [Profile] 

    [Auth] -> [PostgreSQL DB]
    [Matching and Feed engine] -> Our own calculation
    [Profile] -> Redis

Why this architecture?
1. Identity module for auth, simple for now can implement later on
2. Profile to allow for a person to create their own account and upload picture/bios, more information about themselves for another person
3. Matching, we will add custom calculator of matching, this allows the person to match with another based on the information
4. Client application is to allow the user to easily interact with the application.

What is our tech stack for this project?
1. React Native - This is the frontend for the client application
2. Node.js with Express.js - Backend API helps manage asynchronous operations and handling swipe workload, also helps with rendering
3. PostgreSQL - The primary relational database which will be used for profile data, interactions and matches.
4. Redis - In-memory caching and session management, this helps keep the real time swipe fast and prevent bot spam

[FP3] 9/29/2026
### This assignment focuses on account creation.
When a person creates an account we will ask them a questionnaire, the answers from that questionnaire will
eventually be used in a future implementation of a match-match system that matches people through a percentage.

Questionnaire outline (first pass):
- Basics: name, date of birth, gender
- Intent: sexual orientation, relationship goal
- Values and interests: what actually matters to them in a partner
- Lifestyle: schedule, habits, kids, smoking/drinking
- Location: city/coordinates plus the age range and distance they are looking for
- Photos: at least one photo, connects to the honesty/verification work from FP1

How this connects to the match percentage
- The feed already shows a percentage today, it comes from scoreCompatibility in
  matchmakerApp/apps/mobile/src/utils/matching.ts, we are keeping those weights for now and not changing them
- The questionnaire is the data we will need later, the real scoring stays in the Matching and Feed engine
  from FP2 so weights can be tuned without shipping an app update
- This assignment is only about collecting the answers, the percentage math is future work

[FP4] 10/6/2026
### This assignment focuses on making the match interactive instead of static.
So far a user swipes a card and the percentage is derived only from what two people
already told us about themselves in the questionnaire. Nothing in that score says
anything about how two people actually behave, and nothing on the card gives the
user a reason to care about the person on it. For this iteration we want to add a
photo feed people can post into, tag, and react to, so that liking the same content
becomes an actual signal the matcher can read.

The idea: a user uploads an image (a pet photo, say), tags it `pet/cat`, and that
post is attached to their profile. Other users react to the post. If two users react
to the same post, that shared taste is a mutual signal, so we bump the compatibility
percentage and eventually let them match. When that happens we tell them why, in
words, instead of showing a bare number.

Shared feed outline (first pass):
- Post: one image, uploaded by a profile, with at most one primary tag drawn from a
  closed set (the same reason as the questionnaire tags, the matcher has to compare
  two people and free text gives it nothing to compare)
- Tag: a closed set for now, `pet/cat`, `pet/dog`, `outdoors/hiking`, `food/baking`,
  etc. Multi-tag posts are allowed but the first tag is the primary one used for matching
- Reaction: a like and a comment, because FP1 already said effort is what separates
  real users from bots, a one-tap like is the spam surface and a comment is not
- Attached to profile: every post belongs to a profile and shows on that profile, so
  a photo a person posted is also a way of describing them
- Feed: vertical full-screen post feed, separate from the swipe deck, so browsing
  content does not consume a like

Mutual reaction as a match signal
- Two people reacting to the same post is a shared-interest hit we can score the same
  way we score shared questionnaire answers, and it is harder to fake because it costs
  the user an action
- Unlike a tag on a profile, a reaction is directional and mutual, so it reads as
  interest rather than as a stated preference, which is the same honesty problem FP1
  flagged
- We would like the percentage to move when two people react to the same post, and to
  eventually carry that pair into a match, so the score has a cause the user can see

The reason, in words
- This is the Hinge idea from our FP1 market research, the person has to interact with
  something before they can proceed
- A match should come with a sentence the user can check, "you both like posts tagged
  pet/cat", and the profile screen already breaks the score into named signals so
  there is a place to put it
- A reason is also the thing that makes a low percentage acceptable, if the number is
  62 and the sentence underneath says why, the user has something to do with it

How this connects to the match percentage
- scoreCompatibility in matchmakerApp/apps/mobile/src/utils/matching.ts stays the
  source of the percentage and keeps its FP3 weights, the reaction signal gets added
  alongside them rather than replacing them
- The real scoring still belongs in the Matching and Feed engine from FP2, the posts
  and reactions are the new data it reads
- Open question we still have to answer: how much a shared reaction is worth relative
  to a shared questionnaire answer, and whether reacting to a lot of posts should
  stop counting, otherwise one very active user looks compatible with everyone
