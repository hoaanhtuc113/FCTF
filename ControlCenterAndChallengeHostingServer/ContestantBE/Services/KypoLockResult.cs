namespace ContestantBE.Services;

public enum KypoLockResult
{
    Solved,        // all phases done → solve inserted
    NotDone,       // logic: team hasn't finished yet
    AlreadySolved, // solve already existed in DB
    ApiError,      // KYPO API unreachable / exception → allow retry
}
