# Test Cases - Race Condition

Note
All tests assume the target challenge/hint data already exists in the database and matches the configuration values specified in the .env file (IDs, flags, category, dynamic parameters, limits).

Test Case

Test Case ID
HINT-01

Test Case Description
Hint unlock - 10 users from the same team concurrently unlock a hint

Test Case Procedure
1) Configure .env with: HINT_ID=8, CONCURRENCY=10, USE_TOKEN_LIST=true
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
3) Verify the hint is in locked state for this team
4) Execute: k6 run concurrent_hint_unlock.js

Expected Output
- Exactly 1 request unlocks successfully
- Remaining 9 requests return already_unlocked or in_progress

Pre-condition
- Hint with ID=8 exists in the database
- Hint is locked (unlocked count=0 for the team)
- Team has sufficient score to unlock the hint (score >= hint cost)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
HINT-02

Test Case Description
Hint unlock - 1 user sends 10 concurrent requests

Test Case Procedure
1) Configure .env with: HINT_ID=8, CONCURRENCY=10
2) Set TOKEN for one user
3) Verify the hint is in locked state for this team
4) Execute: k6 run concurrent_hint_unlock.js

Expected Output
- Exactly 1 request unlocks successfully
- Remaining 9 requests return already_unlocked or in_progress

Pre-condition
- Hint with ID=8 exists in the database
- Hint is locked (unlocked count=0 for the team)
- Team has sufficient score to unlock the hint (score >= hint cost)
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
HINT-03

Test Case Description
Hint unlock - 10 users from different teams concurrently unlock a hint

Test Case Procedure
1) Configure .env with: HINT_ID=8, CONCURRENCY=10
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
3) Verify the hint is locked for each team
4) Execute: k6 run concurrent_hint_unlock.js

Expected Output
- 10 requests unlock successfully (1 per team)
- 0 requests are blocked by another team

Pre-condition
- Hint with ID=8 exists in the database
- Hint is locked for all teams (unlocked count=0 per team)
- Each team has sufficient score to unlock the hint (score >= hint cost)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
START-01

Test Case Description
Start challenge - 10 users from the same team concurrently start one deployable challenge

Test Case Procedure
1) Configure .env with: START_CHALLENGE_ID=2 (or CHALLENGE_ID=3), CONCURRENCY=10, USE_TOKEN_LIST=true
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
3) Verify the challenge RequireDeploy=true and not started
4) Execute: k6 run concurrent_start_challenge.js

Expected Output
- Exactly 1 request starts successfully
- Remaining 9 requests return already_started, in_progress, forbidden, or limit

Pre-condition
- Challenge with ID=2 (or 3) exists in the database
- Challenge has RequireDeploy=true
- Challenge is not started (running instances=0 for the team)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team
- If captain-only start is enabled, tokens must be captain tokens

Test Case

Test Case ID
START-02

Test Case Description
Start challenge - 1 user sends 10 concurrent requests

Test Case Procedure
1) Configure .env with: START_CHALLENGE_ID=2 (or CHALLENGE_ID=3), CONCURRENCY=10
2) Set TOKEN for one user
3) Verify the challenge RequireDeploy=true and not started
4) Execute: k6 run concurrent_start_challenge.js

Expected Output
- Exactly 1 request starts successfully
- Remaining 9 requests return already_started, in_progress, forbidden, or limit

Pre-condition
- Challenge with ID=2 (or 3) exists in the database
- Challenge has RequireDeploy=true
- Challenge is not started (running instances=0 for the team)
- Backend service is running and accessible
- Authentication token is valid
- If captain-only start is enabled, token must be a captain token

Test Case

Test Case ID
START-03

Test Case Description
Start challenge - 10 users from different teams concurrently start one deployable challenge

Test Case Procedure
1) Configure .env with: START_CHALLENGE_ID=2 (or CHALLENGE_ID=3), CONCURRENCY=10
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
3) Verify the challenge RequireDeploy=true and not started for each team
4) Execute: k6 run concurrent_start_challenge.js

Expected Output
- 10 requests start successfully (1 per team)
- 0 requests are blocked by another team

Pre-condition
- Challenge with ID=2 (or 3) exists in the database
- Challenge has RequireDeploy=true
- Challenge is not started for all teams (running instances=0 per team)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
STOP-01

Test Case Description
Stop challenge - 10 users from the same team concurrently stop a running challenge

Test Case Procedure
1) Configure .env with: STOP_CHALLENGE_ID=2 (or START_CHALLENGE_ID=2/CHALLENGE_ID=3), CONCURRENCY=10, USE_TOKEN_LIST=true
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
3) Verify the challenge is running (or set START_BEFORE_STOP=true)
4) Execute: k6 run concurrent_stop_challenge.js

Expected Output
- Exactly 1 request stops successfully
- Remaining 9 requests return already_stopped, in_progress, forbidden, or limit

Pre-condition
- Challenge with ID=2 (or 3) exists in the database
- Challenge is running with 1 instance for the team
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
STOP-02

Test Case Description
Stop challenge - 1 user sends 10 concurrent requests

Test Case Procedure
1) Configure .env with: STOP_CHALLENGE_ID=2 (or START_CHALLENGE_ID=2/CHALLENGE_ID=3), CONCURRENCY=10
2) Set TOKEN for one user
3) Verify the challenge is running (or set START_BEFORE_STOP=true)
4) Execute: k6 run concurrent_stop_challenge.js

Expected Output
- Exactly 1 request stops successfully
- Remaining 9 requests return already_stopped, in_progress, forbidden, or limit

Pre-condition
- Challenge with ID=2 (or 3) exists in the database
- Challenge is running with 1 instance for the team
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
STOP-03

Test Case Description
Stop challenge - 10 users from different teams concurrently stop a running challenge

Test Case Procedure
1) Configure .env with: STOP_CHALLENGE_ID=2 (or START_CHALLENGE_ID=2/CHALLENGE_ID=3), CONCURRENCY=10
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
3) Verify the challenge is running for each team (or set START_BEFORE_STOP=true)
4) Execute: k6 run concurrent_stop_challenge.js

Expected Output
- 10 requests stop successfully (1 per team)
- 0 requests are blocked by another team

Pre-condition
- Challenge with ID=2 (or 3) exists in the database
- Challenge is running with 1 instance per team
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
MAX-01

Test Case Description
Max attempts - 10 users from the same team concurrently submit incorrect flags

Test Case Procedure
1) Configure .env with: MAX_ATTEMPTS_CHALLENGE_ID=167 (or CHALLENGE_ID=3), WRONG_FLAG=123, CONCURRENCY=10, USE_TOKEN_LIST=true
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
3) Verify the challenge has max_attempts=5 and remaining attempts = 5
4) Execute: k6 run concurrent_max_attempts.js

Expected Output
- Exactly 5 requests are recorded as incorrect
- Remaining 5 requests return max_attempts_exceeded

Pre-condition
- Challenge with ID=167 (or 3) exists in the database
- Challenge has max_attempts=5 configured
- Challenge has cooldown=0 (or no cooldown)
- Team has remaining attempts = 5 (no prior attempts)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
MAX-02

Test Case Description
Max attempts - 1 user sends 10 concurrent requests

Test Case Procedure
1) Configure .env with: MAX_ATTEMPTS_CHALLENGE_ID=167 (or CHALLENGE_ID=3), WRONG_FLAG=123, CONCURRENCY=10
2) Set TOKEN for one user
3) Verify the challenge has max_attempts=5 and remaining attempts = 5
4) Execute: k6 run concurrent_max_attempts.js

Expected Output
- Exactly 5 requests are recorded as incorrect
- Remaining 5 requests return max_attempts_exceeded

Pre-condition
- Challenge with ID=167 (or 3) exists in the database
- Challenge has max_attempts=5 configured
- Challenge has cooldown=0 (or no cooldown)
- Team has remaining attempts = 5 (no prior attempts)
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
MAX-03

Test Case Description
Max attempts - 10 users from different teams concurrently submit incorrect flags

Test Case Procedure
1) Configure .env with: MAX_ATTEMPTS_CHALLENGE_ID=167 (or CHALLENGE_ID=3), WRONG_FLAG=123, CONCURRENCY=10
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
3) Verify the challenge has max_attempts=5 and remaining attempts = 1 per team
4) Execute: k6 run concurrent_max_attempts.js

Expected Output
- 10 requests are recorded as incorrect (1 per team)
- 0 requests return max_attempts_exceeded

Pre-condition
- Challenge with ID=167 (or 3) exists in the database
- Challenge has max_attempts=5 configured
- Challenge has cooldown=0 (or no cooldown)
- Each team has remaining attempts = 1 (4 prior attempts already used)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
COOL-01

Test Case Description
Cooldown - 10 users from the same team concurrently submit incorrect flags during cooldown

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, WRONG_FLAG=123, CONCURRENCY=10, USE_TOKEN_LIST=true
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
3) Verify the challenge has cooldown=5s
4) Execute: k6 run concurrent_cooldown_attempts.js

Expected Output
- Exactly 1 request passes the cooldown check
- Remaining 9 requests are ratelimited or return cooldown errors

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has cooldown=5 seconds configured
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
COOL-02

Test Case Description
Cooldown - 1 user sends 10 concurrent requests

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, WRONG_FLAG=123, CONCURRENCY=10
2) Set TOKEN for one user
3) Verify the challenge has cooldown=5s
4) Execute: k6 run concurrent_cooldown_attempts.js

Expected Output
- Exactly 1 request passes the cooldown check
- Remaining 9 requests are ratelimited or return cooldown errors

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has cooldown=5 seconds configured
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
COOL-03

Test Case Description
Cooldown - 10 users from different teams concurrently submit incorrect flags

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, WRONG_FLAG=123, CONCURRENCY=10
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
3) Verify the challenge has cooldown=5s
4) Execute: k6 run concurrent_cooldown_attempts.js

Expected Output
- 10 requests pass the cooldown check (1 per team)
- 0 requests are ratelimited

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has cooldown=5 seconds configured
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
CORRECT-01

Test Case Description
Correct submissions - 10 users from the same team concurrently submit correct flags

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, CHALLENGE_FLAG=a, CONCURRENCY=10, USE_TOKEN_LIST=true
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
3) Verify the challenge is not solved by the team
4) Execute: k6 run concurrent_correct_submissions.js

Expected Output
- Exactly 1 request is recorded as correct
- Remaining 9 requests return already_solved or ratelimited

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has flag="a" configured
- Challenge is not solved by the team (solve count=0)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
CORRECT-02

Test Case Description
Correct submissions - 1 user sends 10 concurrent requests

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, CHALLENGE_FLAG=a, CONCURRENCY=10
2) Set TOKEN for one user
3) Verify the challenge is not solved by the user
4) Execute: k6 run concurrent_correct_submissions.js

Expected Output
- Exactly 1 request is recorded as correct
- Remaining 9 requests return already_solved or ratelimited

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has flag="a" configured
- Challenge is not solved by the user (solve count=0)
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
CORRECT-03

Test Case Description
Correct submissions - 10 users from different teams concurrently submit correct flags

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, CHALLENGE_FLAG=a, CONCURRENCY=10
2) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
3) Verify the teams have not solved the challenge
4) Execute: k6 run concurrent_correct_submissions.js

Expected Output
- 10 requests are recorded as correct (1 per team)
- 0 requests are blocked by another team

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has flag="a" configured
- Challenge is not solved by any team (solve count=0 per team)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
DYN-01

Test Case Description
Dynamic recalculation - 10 users from the same team concurrently submit correct flags

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, CHALLENGE_FLAG=a, CHALLENGE_CATEGORY=Web
2) Configure .env with: DYN_FUNCTION=logarithmic, DYN_INITIAL=100, DYN_DECAY=9, DYN_MINIMUM=20
3) Configure .env with: DYN_EXPECTED_SOLVE_COUNT=10, DYN_POLL_ATTEMPTS=10, DYN_POLL_DELAY_MS=500
4) Configure .env with: CONCURRENCY=10, USE_TOKEN_LIST=true
5) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
6) Verify the challenge type is dynamic and not solved
7) Execute: k6 run concurrent_dynamic_recalc.js

Expected Output
- Exactly 1 request is recorded as correct
- Remaining 9 requests return already_solved or ratelimited
- Dynamic value remains at 100 (first solver adjustment keeps value at 100)
- Team receives 100 points
- Formula: value = ((20-100)/81) × (0)² + 100 = 100
- Total solve count increases from 0 to 1

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has flag="a" configured
- Challenge type is dynamic with function=logarithmic, initial=100, decay=9, minimum=20
- Challenge category is "Web"
- Challenge is not solved by the team (solve count=0)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
LIMIT-01

Test Case Description
Challenge limit (limit_challenges) - 10 users from the same team start different challenges when the team is already at limit

Test Case Procedure
1) Configure .env with: CHALLENGE_ID_LIST=11,12,13,14,15,16,17,18,19,20
2) Configure .env with: CONCURRENCY=10, USE_TOKEN_LIST=true, STRICT=true
3) Configure .env with: EXPECT_LIMIT=true, EXPECT_MAX_START=0
4) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
5) Verify limit_challenges=1 in system configuration
6) Verify the team already has 1 running instance
7) Execute: k6 run concurrent_start_challenge.js

Expected Output
- 0 starts are accepted
- 10 requests return the maximum limit error

Pre-condition
- All challenges with IDs 11-20 exist in the database
- All challenges have RequireDeploy=true
- System configuration has limit_challenges=1
- Team already has 1 running instance (any challenge)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
LIMIT-02

Test Case Description
Challenge limit (limit_challenges) - 1 user starts different challenges when the team is already at limit

Test Case Procedure
1) Configure .env with: CHALLENGE_ID_LIST=11,12,13,14,15,16,17,18,19,20
2) Configure .env with: CONCURRENCY=10, STRICT=true
3) Configure .env with: EXPECT_LIMIT=true, EXPECT_MAX_START=0
4) Set TOKEN for one user
5) Verify limit_challenges=1 in system configuration
6) Verify the team already has 1 running instance
7) Execute: k6 run concurrent_start_challenge.js

Expected Output
- 0 starts are accepted
- 10 requests return the maximum limit error

Pre-condition
- All challenges with IDs 11-20 exist in the database
- All challenges have RequireDeploy=true
- System configuration has limit_challenges=1
- Team already has 1 running instance (any challenge)
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
LIMIT-03

Test Case Description
Challenge limit (limit_challenges) - 10 users from different teams start different challenges while each team is at limit

Test Case Procedure
1) Configure .env with: CHALLENGE_ID_LIST=11,12,13,14,15,16,17,18,19,20
2) Configure .env with: CONCURRENCY=10, STRICT=true
3) Configure .env with: EXPECT_LIMIT=true, EXPECT_MAX_START=0
4) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
5) Verify limit_challenges=1 in system configuration
6) Verify each team already has 1 running instance
7) Execute: k6 run concurrent_start_challenge.js

Expected Output
- 0 starts are accepted
- 10 requests return the maximum limit error

Pre-condition
- All challenges with IDs 11-20 exist in the database
- All challenges have RequireDeploy=true
- System configuration has limit_challenges=1
- Each team already has 1 running instance (any challenge)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
LIMIT-04

Test Case Description
Challenge limit (limit_challenges) - 10 users from the same team concurrently start different challenges

Test Case Procedure
1) Configure .env with: CHALLENGE_ID_LIST=11,12,13,14,15,16,17,18,19,20
2) Configure .env with: CONCURRENCY=10, USE_TOKEN_LIST=true, STRICT=true
3) Configure .env with: EXPECT_LIMIT=true, EXPECT_MAX_START=1
4) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from the same team
5) Verify limit_challenges=1 in system configuration
6) Verify the team has 0 running instances
7) Execute: k6 run concurrent_start_challenge.js

Expected Output
- Exactly 1 start is accepted (success or in_progress)
- Remaining 9 requests return the maximum limit error

Pre-condition
- All challenges with IDs 11-20 exist in the database
- All challenges have RequireDeploy=true and are not started
- System configuration has limit_challenges=1
- Team has 0 running instances
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to the same team

Test Case

Test Case ID
LIMIT-05

Test Case Description
Challenge limit (limit_challenges) - 1 user sends 10 concurrent start requests for different challenges

Test Case Procedure
1) Configure .env with: CHALLENGE_ID_LIST=11,12,13,14,15,16,17,18,19,20
2) Configure .env with: CONCURRENCY=10, STRICT=true
3) Configure .env with: EXPECT_LIMIT=true, EXPECT_MAX_START=1
4) Set TOKEN for one user
5) Verify limit_challenges=1 in system configuration
6) Verify the team has 0 running instances
7) Execute: k6 run concurrent_start_challenge.js

Expected Output
- Exactly 1 start is accepted (success or in_progress)
- Remaining 9 requests return the maximum limit error

Pre-condition
- All challenges with IDs 11-20 exist in the database
- All challenges have RequireDeploy=true and are not started
- System configuration has limit_challenges=1
- Team has 0 running instances
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
LIMIT-06

Test Case Description
Challenge limit (limit_challenges) - 10 users from different teams start a new challenge while each team is at its limit

Test Case Procedure
1) Configure .env with: CHALLENGE_ID_LIST=11,12,13,14,15,16,17,18,19,20
2) Configure .env with: CONCURRENCY=10, STRICT=true
3) Configure .env with: EXPECT_LIMIT=true, EXPECT_MAX_START=0
4) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
5) Verify limit_challenges=1 in system configuration
6) Verify each team already has 1 running instance
7) Execute: k6 run concurrent_start_challenge.js

Expected Output
- 0 starts are accepted
- 10 requests return the maximum limit error

Pre-condition
- All challenges with IDs 11-20 exist in the database
- All challenges have RequireDeploy=true and are not started
- System configuration has limit_challenges=1
- Each team already has 1 running instance (different challenge)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
DYN-02

Test Case Description
Dynamic recalculation - 1 user sends 10 concurrent requests (Linear function)

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, CHALLENGE_FLAG=a, CHALLENGE_CATEGORY=Web
2) Configure .env with: DYN_FUNCTION=linear, DYN_INITIAL=100, DYN_DECAY=5, DYN_MINIMUM=20
3) Configure .env with: DYN_EXPECTED_SOLVE_COUNT=10, DYN_POLL_ATTEMPTS=10, DYN_POLL_DELAY_MS=500
4) Configure .env with: CONCURRENCY=10
5) Set TOKEN for one user
6) Verify the challenge type is dynamic and not solved
7) Execute: k6 run concurrent_dynamic_recalc.js

Expected Output
- Exactly 1 request is recorded as correct
- Remaining 9 requests return already_solved or ratelimited
- Dynamic value remains at 100 (first solver gets initial value, value stays 100 after 1 solve)
- Team receives 100 points
- Formula: value = 100 - 5 × (solve_count - 1) = 100 - 5 × 0 = 100
- Total solve count increases from 0 to 1

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has flag="a" configured
- Challenge type is dynamic with function=linear, initial=100, decay=5, minimum=20
- Challenge category is "Web"
- Challenge is not solved by the user (solve count=0)
- Backend service is running and accessible
- Authentication token is valid

Test Case

Test Case ID
DYN-03

Test Case Description
Dynamic recalculation - 10 users from different teams concurrently submit correct flags

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, CHALLENGE_FLAG=a, CHALLENGE_CATEGORY=Web
2) Configure .env with: DYN_FUNCTION=logarithmic, DYN_INITIAL=100, DYN_DECAY=9, DYN_MINIMUM=20
3) Configure .env with: DYN_EXPECTED_SOLVE_COUNT=10, DYN_POLL_ATTEMPTS=10, DYN_POLL_DELAY_MS=500
4) Configure .env with: CONCURRENCY=10
5) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
6) Verify the challenge type is dynamic and the teams have not solved it
7) Execute: k6 run concurrent_dynamic_recalc.js

Expected Output
- 10 requests are recorded as correct (1 per team)
- Dynamic value changes from 100 to 37 (after 10 solves)
- Teams receive scores: 100, 100, 99, 96, 91, 84, 75, 64, 52, 37
- Formula: value = ((20-100)/81) × (adjusted_count)² + 100 = -0.988 × (count)² + 100
- Total solve count increases from 0 to 10

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has flag="a" configured
- Challenge type is dynamic with function=logarithmic, initial=100, decay=9, minimum=20
- Challenge category is "Web"
- Challenge is not solved by any team (solve count=0 per team)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams

Test Case

Test Case ID
DYN-04

Test Case Description
Dynamic recalculation - 10 users from different teams concurrently submit correct flags (Linear function)

Test Case Procedure
1) Configure .env with: CHALLENGE_ID=3, CHALLENGE_FLAG=a, CHALLENGE_CATEGORY=Web
2) Configure .env with: DYN_FUNCTION=linear, DYN_INITIAL=100, DYN_DECAY=5, DYN_MINIMUM=20
3) Configure .env with: DYN_EXPECTED_SOLVE_COUNT=10, DYN_POLL_ATTEMPTS=10, DYN_POLL_DELAY_MS=500
4) Configure .env with: CONCURRENCY=10
5) Prepare TOKEN_FILE/TOKEN_LIST with 10 tokens from different teams
6) Verify the challenge type is dynamic and the teams have not solved it
7) Execute: k6 run concurrent_dynamic_recalc.js

Expected Output
- 10 requests are recorded as correct (1 per team)
- Dynamic value changes from 100 to 55 (after 10 solves)
- Teams receive scores: 100, 100, 95, 90, 85, 80, 75, 70, 65, 60
- Formula: value = 100 - 5 × (solve_count - 1), minimum 20
- Total solve count increases from 0 to 10

Pre-condition
- Challenge with ID=3 exists in the database
- Challenge has flag="a" configured
- Challenge type is dynamic with function=linear, initial=100, decay=5, minimum=20
- Challenge category is "Web"
- Challenge is not solved by any team (solve count=0 per team)
- Backend service is running and accessible
- All 10 authentication tokens are valid and belong to different teams
