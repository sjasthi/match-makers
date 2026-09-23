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