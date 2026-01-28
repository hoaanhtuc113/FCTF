using ContestantBE.Utils;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using ResourceShared;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.File;
using ResourceShared.DTOs.Topic;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Utils;
using RestSharp;
using StackExchange.Redis;
using System.Net;

namespace ContestantBE.Services;

public interface IChallengeServices
{
    Task<ChallengeDeployResponeDTO> ChallengeStart(Challenge challenge, User user);
    Task<ChallengeDeployResponeDTO> ForceStopChallenge(int challengeId, User user);
    Task<ChallengeDeployResponeDTO> CheckChallengeStart(int challengeId, int teamId);
    Task<BaseResponseDTO<ChallengeByIdDTO>> GetById(int challengeId, User user);
    Task<List<TopicDTO>> GetTopic(User user);
    Task<List<ChallengeByCategoryDTO>> GetChallengeByCategories(string cacategory_name, int? team_id);
    Task<List<ChallengeInstanceDTO>> GetAllInstances(int teamId);
}

public class ChallengeServices : IChallengeServices
{
    private readonly AppDbContext _dbContext;
    private readonly RedisHelper _redisHelper;
    private readonly ConfigHelper _configHelper;
    private readonly AppLogger _logger;
    private readonly MultiServiceConnector _multiServiceConnector;
    public ChallengeServices(
        AppDbContext dbContext,
        RedisHelper redisHelper,
        ConfigHelper configHelper,
        AppLogger logger,
        MultiServiceConnector multiServiceConnector)
    {
        _dbContext = dbContext;
        _redisHelper = redisHelper;
        _configHelper = configHelper;
        _logger = logger;
        _multiServiceConnector = multiServiceConnector;
    }
    public async Task<BaseResponseDTO<ChallengeByIdDTO>> GetById(int challengeId, User user)
    {
        var challenge = await _dbContext.Challenges
            .AsNoTracking()
            .Include(c => c.Files)
            .FirstOrDefaultAsync(c => c.Id == challengeId);

        if (challenge == null)
        {
            return new BaseResponseDTO<ChallengeByIdDTO>
            {
                HttpStatusCode = HttpStatusCode.NotFound,
                Message = "Challenge not found"
            };
        }
        if (challenge.State == "hidden")
        {
            return new BaseResponseDTO<ChallengeByIdDTO>
            {
                HttpStatusCode = HttpStatusCode.NotFound,
                Message = "Challenge now is not available"
            };
        }

        var solve_id = await _dbContext.Solves
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);

        var attempts = await _dbContext.Submissions
            .AsNoTracking()
            .CountAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);

        var files = new List<object>();
        foreach (var file in challenge.Files)
        {
            var token = new FileTokenDTOs
            {
                user_id = user.Id,
                team_id = user.TeamId,
                file_id = file.Id
            };
            var file_url = $"/files?path={file.Location}&token={ItsDangerousCompatHelper.Dumps(token)}";

            if (file_url != null) files.Add(file_url);
        }
        var captainOnlyStart = _configHelper.GetConfig<bool>("captain_only_start_challenge", true);
        var captainOnlySubmit = _configHelper.GetConfig<bool>("captain_only_submit_challenge", true);
        var challenge_data = new ChallengeDataDto
        {
            id = challenge.Id,
            name = challenge.Name ?? string.Empty,
            description = ChallengeHelper.ModifyDescription(challenge),
            max_attempts = challenge.MaxAttempts,
            attemps = attempts,
            category = challenge.Category,
            time_limit = challenge.TimeLimit,
            require_deploy = challenge.RequireDeploy,
            type = challenge.Type,
            next_id = challenge.NextId,
            solve_by_myteam = solve_id != null ? true : false,
            files = files,
            is_captain = user.Id == user.Team.CaptainId,
            captain_only_start = captainOnlyStart,
            captain_only_submit = captainOnlySubmit,
        };

        var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.Team.Id);
        if (await _redisHelper.KeyExistsAsync(cache_key))
        {
            var cached_value = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(cache_key);
            if (cached_value == null)
            {
                return new BaseResponseDTO<ChallengeByIdDTO>
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    Data = new ChallengeByIdDTO
                    {
                        challenge = challenge_data,
                        is_started = false
                    }
                };
            }

            var user_chal = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == cached_value.user_id);

            if (cached_value.challenge_id == challenge.Id)
            {
                var time_finished = cached_value.time_finished;
                var time_remaining = time_finished - DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                if (time_remaining < 0) time_remaining = 0;


                return new BaseResponseDTO<ChallengeByIdDTO>
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    Message = $"Challenge was started by: {user_chal.Name}",
                    Data = new ChallengeByIdDTO
                    {
                        challenge = challenge_data,
                        is_started = true,
                        challenge_url = cached_value.challenge_url,
                        time_remaining = time_remaining,
                        pod_status = cached_value.status
                    }
                };
            }


        }
        return new BaseResponseDTO<ChallengeByIdDTO>
        {
            HttpStatusCode = HttpStatusCode.OK,
            Data = new ChallengeByIdDTO
            {
                success = true,
                challenge = challenge_data,
                is_started = false
            }
        };
    }

    public async Task<List<ChallengeByCategoryDTO>> GetChallengeByCategories(string category_name, int? team_id)
    {
        var challenges = await _dbContext.Challenges
            .AsNoTracking()
            .Where(c => c.Category == category_name &&
                        c.State != Enums.ChallengeState.HIDDEN)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.NextId,
                c.MaxAttempts,
                c.Value,
                c.Category,
                c.TimeLimit,
                c.Type,
                c.Requirements,
                c.RequireDeploy
            })
            .ToListAsync();

        var topics_data = new List<ChallengeByCategoryDTO>();

        var solvedChallengeIds = team_id.HasValue
                ? (await _dbContext.Solves
                    .AsNoTracking()
                    .Where(s => s.TeamId == team_id.Value)
                    .Select(s => s.ChallengeId)
                    .ToListAsync())
                    .ToHashSet()
                : [];

        var deployChallenges = challenges
            .Where(c => c.RequireDeploy && team_id.HasValue)
            .Select(c => ChallengeHelper.GetCacheKey(c.Id, team_id!.Value))
            .ToList();

        var deploymentCaches = deployChallenges.Count != 0
            ? await _redisHelper.GetManyAsync<ChallengeDeploymentCacheDTO>(deployChallenges)
            : [];

        foreach (var challenge in challenges)
        {
            // Parse requirements JSON string
            ChallengeRequirementsDTO? requirementsObj = null;
            if (!string.IsNullOrEmpty(challenge.Requirements))
            {
                try
                {
                    requirementsObj = JsonConvert.DeserializeObject<ChallengeRequirementsDTO>(challenge.Requirements);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, null, team_id, new { challengeId = challenge.Id, requirements = challenge.Requirements });
                    await Console.Error.WriteLineAsync($"Error parsing requirements for challenge {challenge.Id}: {ex.Message}");
                }
            }

            // Check pod status if challenge requires deployment
            string? podStatus = null;
            if (challenge.RequireDeploy && team_id.HasValue)
            {
                var key = ChallengeHelper.GetCacheKey(challenge.Id, team_id.Value);
                if (deploymentCaches.TryGetValue(key, out var cache))
                    podStatus = cache?.status;
            }

            topics_data.Add(new ChallengeByCategoryDTO
            {
                id = challenge.Id,
                name = challenge.Name ?? string.Empty,
                next_id = challenge.NextId,
                max_attempts = challenge.MaxAttempts,
                value = challenge.Value,
                category = challenge.Category,
                time_limit = challenge.TimeLimit,
                type = challenge.Type,
                requirements = requirementsObj,
                solve_by_myteam = solvedChallengeIds.Contains(challenge.Id),
                pod_status = podStatus,
            });
        }

        return topics_data;
    }

    public async Task<List<TopicDTO>> GetTopic(User user)
    {
        var challengeStats = await _dbContext.Challenges
            .AsNoTracking()
            .Where(c => c.State != Enums.ChallengeState.HIDDEN)
            .GroupBy(c => c.Category)
            .Select(g => new
            {
                Category = g.Key!,
                Total = g.Count()
            })
            .ToListAsync();


        var solvedStats = await _dbContext.Solves
            .AsNoTracking()
            .Where(s => s.TeamId == user.TeamId &&
                        s.Challenge.State != Enums.ChallengeState.HIDDEN)
            .GroupBy(s => s.Challenge.Category)
            .Select(g => new
            {
                Category = g.Key!,
                Solved = g.Select(x => x.ChallengeId).Distinct().Count()
            })
            .ToListAsync();

        var solvedDict = solvedStats.ToDictionary(x => x.Category, x => x.Solved);

        var topics = new List<TopicDTO>(challengeStats.Count);

        foreach (var stat in challengeStats)
        {
            var solved = solvedDict.TryGetValue(stat.Category, out var s)
                ? s
                : 0;

            topics.Add(new TopicDTO
            {
                topic_name = stat.Category,
                challenge_count = stat.Total,
                cleared = solved >= stat.Total
            });
        }
        return topics;
    }

    public async Task<ChallengeDeployResponeDTO> ChallengeStart(Challenge challenge, User user)
    {
        try
        {
            var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var parammeters = new ChallengeStartStopReqDTO
            {
                challengeId = challenge.Id,
                teamId = user.TeamId.Value,
                userId = user.Id,
                unixTime = unixTime.ToString()
            };
            var data = new Dictionary<string, string>
            {
                { "challengeId", challenge.Id.ToString() },
                { "teamId", user.TeamId.Value.ToString() },
                { "userId", user.Id.ToString() },
            };
            string generatedSecretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);

            var headers = new Dictionary<string, string>
            {
                { "SecretKey", generatedSecretKey }
            };

            var body = await _multiServiceConnector.ExecuteRequest(
                ContestantBEConfigHelper.DeploymentCenterAPI,
                "/api/challenge/start",
                Method.Post,
                parammeters,
                headers);

            if (body == null)
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadRequest,
                    success = false,
                    message = "No response from server"
                };

            var result = JsonConvert.DeserializeObject<ChallengeDeployResponeDTO>(body);
            if (result == null)
            {
                await Console.Out.WriteLineAsync("Failed to deserialize response");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Failed to parse server response"
                };
            }
            return result;

        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex);
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadGateway,
                success = false,
                message = "Connection url failed"
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, user?.Id, user?.TeamId, new { challengeId = challenge.Id });
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.InternalServerError,
                success = false,
                message = "Unexpected error occurred"
            };
        }
    }

    public async Task<ChallengeDeployResponeDTO> ForceStopChallenge(int challengeId, User user)
    {
        var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var data = new Dictionary<string, string>
        {
            { "challengeId", challengeId.ToString() },
            { "teamId", user?.TeamId?.ToString() ?? string.Empty},
        };
        var parammeters = new ChallengeStartStopReqDTO
        {
            challengeId = challengeId,
            teamId = user.TeamId.Value,
            unixTime = unixTime.ToString()
        };
        var secretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);
        var headers = new Dictionary<string, string>
        {
            { "SecretKey", secretKey }
        };

        try
        {
            var body = await _multiServiceConnector.ExecuteRequest(
                ContestantBEConfigHelper.DeploymentCenterAPI,
                "/api/challenge/stop",
                Method.Post,
                parammeters,
                headers);

            if (body == null)
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadRequest,
                    success = false,
                    message = "No response from server when stopping challenge"
                };

            var result = JsonConvert.DeserializeObject<ChallengeDeployResponeDTO>(body);
            if (result == null)
            {
                await Console.Out.WriteLineAsync("Failed to deserialize response");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Failed to parse server response"
                };
            }
            return result;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex);
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadGateway,
                success = false,
                message = "Connection url failed"
            };
        }
    }

    public async Task<List<ChallengeInstanceDTO>> GetAllInstances(int teamId)
    {
        var deployments = await _redisHelper
            .GetCacheByPatternAsync<ChallengeDeploymentCacheDTO>($"deploy_challenge_*_{teamId}");

        if (deployments.Count == 0)
            return [];

        var challengeIds = deployments
            .Select(x => x.challenge_id)
            .Distinct()
            .ToList();

        var challenges = await _dbContext.Challenges
            .AsNoTracking()
            .Where(c => challengeIds.Contains(c.Id))
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Category
            })
            .ToListAsync();

        var challengeDict = challenges.ToDictionary(c => c.Id);

        var result = new List<ChallengeInstanceDTO>(deployments.Count);

        foreach (var instance in deployments)
        {
            if (!challengeDict.TryGetValue(instance.challenge_id, out var challenge))
                continue;

            result.Add(new ChallengeInstanceDTO
            {
                challenge_id = instance.challenge_id,
                challenge_name = challenge.Name ?? string.Empty,
                category = challenge.Category ?? string.Empty,
                status = instance.status ?? string.Empty,
                challenge_url = instance.challenge_url ?? "N/A",
                ready = instance.ready,
                age = instance.time_finished.ToString()
            });
        }
        return result;
    }

    public async Task<ChallengeDeployResponeDTO> CheckChallengeStart(int challengeId, int teamId)
    {
        try
        {
            var deploymentKey = ChallengeHelper.GetCacheKey(challengeId, teamId);

            var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);

            if (deploymentCache == null)
            {
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "No deployment info found.",
                    status = (int)HttpStatusCode.NotFound
                };
            }

            var challenge = await _dbContext.Challenges
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == challengeId);

            if (challenge == null)
            {
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Challenge not found.",
                    status = (int)HttpStatusCode.NotFound
                };
            }

            if (deploymentCache.status == Enums.DeploymentStatus.PENDING_DEPLOY)
            {
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Challenge is waitting to deploy",
                    status = (int)HttpStatusCode.OK,
                    pod_status = Enums.DeploymentStatusEnum.PENDING_DEPLOY
                };
            }
            if (deploymentCache.status == Enums.DeploymentStatus.PENDING)
            {
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Challenge is currently deploying",
                    status = (int)HttpStatusCode.OK,
                    pod_status = Enums.DeploymentStatusEnum.Pending
                };
            }
            if (deploymentCache.status == Enums.DeploymentStatus.RUNING && deploymentCache.ready)
            {

                var result = new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.OK,
                    success = true,
                    message = "Pod is running.",
                    challenge_url = deploymentCache.challenge_url,
                    time_limit = challenge.TimeLimit ?? -1,
                    pod_status = Enums.DeploymentStatusEnum.Running
                };
                return result;
            }
            return new ChallengeDeployResponeDTO
            {
                success = false,
                message = "Pod is not running.",
                status = (int)HttpStatusCode.OK,
                pod_status = Enums.DeploymentStatusEnum.TIMEOUT
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, null, teamId, new { challengeId });
            return new ChallengeDeployResponeDTO
            {
                success = false,
                message = "Error during status check.",
                status = (int)HttpStatusCode.InternalServerError,
                pod_status = Enums.DeploymentStatusEnum.Failed
            };
        }
    }
}
