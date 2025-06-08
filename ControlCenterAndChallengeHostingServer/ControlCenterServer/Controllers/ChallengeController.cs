using ControlCenterServer.Configs;
using ControlCenterServer.DTOs.ChallengeDTOs;
using ControlCenterServer.Middlewares;
using ResourceShared.Models;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.Models;
using ResourceShared.ResponseViews;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace ControlCenterServer.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [RequireSecretKey]
    public class ChallengeController : ControllerBase
    {
        private static object _lock = new object();
        private static ConcurrentDictionary<int, SemaphoreSlim> TeamDeployQueue = new();
        private readonly IConnectionMultiplexer _connectionMultiplexer;
        public ChallengeController(IConnectionMultiplexer connectionMultiplexer)
        {
            _connectionMultiplexer = connectionMultiplexer;
        }

        [HttpPost("upload")]
        public async Task<IActionResult> UploadFile([FromForm] int challengeId, [FromForm] IFormFile file)
        {
            try
            {
                await Console.Out.WriteLineAsync($"Received upload request for challenge ID {challengeId}");

                // check key redis deploy ton tai hay khong
                RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);

                // set gia tri cho redis deploy key
                string redisDeployKey = $"{RedisConfigs.RedisDeployKey}{challengeId}";
                // get value redis deploy key 
                var redisGetDeployInfo = await redisHelper.GetFromCacheAsync<DeploymentInfo>(redisDeployKey);

                var UnixTimeNow = DateTimeHelper.GetDateTimeNowInUnix();
                string SecretKey = SecretKeyHelper.CreateSecretKey(UnixTimeNow, new());

                string TargetServerId = "";
                // neu chua deploy
                if (redisGetDeployInfo == null)
                {
                    List<ClusterUsageByPercent> performanceStatList = new List<ClusterUsageByPercent>();
                    foreach (ChallengeServerInfo challengeServerInfo in ControlCenterServiceConfig.ChallengeServerInfoList)
                    {
                        var request = new RestRequest();
                        request.Method = Method.Post;
                        request.Resource = "api/performance/stat";
                        request.AddHeader("SecretKey", SecretKey);

                        Dictionary<string, object> requestDictionary = new Dictionary<string, object>
                        {
                            { "UnixTime", UnixTimeNow },
                        };
                        string baseUrl = challengeServerInfo.ServerHost + ":" + challengeServerInfo.ServerPort;
           await             Console.Out.WriteLineAsync("LINE: 68----"+baseUrl+"---"+JsonConvert.SerializeObject(request));
                        MultiServiceConnector multiServiceConnector = new MultiServiceConnector(baseUrl);
                        var response
                          = await multiServiceConnector.ExecuteRequest<GenaralViewResponseData<ClusterUsageByPercent>>(request, requestDictionary, RequestContentType.Form);
                        if (response != null && !response.IsSuccess)
                        {
                            return BadRequest(response);
                        }

                        await             Console.Out.WriteLineAsync("LINE: 76");

                        if (response != null && response.data != null)
                        {
                            ClusterUsageByPercent? performanceStatistic = response.data;
                            performanceStatList.Add(performanceStatistic!);
                        }
                    }

                    // uu tien nhung con host co cpu usage < 50% va con nhieu available memory 
                    var bestPerformanceHost = performanceStatList.Where(stat => stat.CpuUsage < 50)
                    .OrderByDescending(stat => stat.RamUsage)
                    .FirstOrDefault();

                    // neu khong co nhung con co cpu usage < 50% thi uu tien nhung con co available memory > 20% va cpu usage min
                    if (bestPerformanceHost == null)
                    {
                        bestPerformanceHost = performanceStatList.Where(stat => stat.RamUsage > 20)
                        .OrderBy(stat => stat.CpuUsage)
                        .FirstOrDefault();
                    }

                    if (bestPerformanceHost == null)
                    {
                        return BadRequest(new GeneralView
                        {
                            Message = "No host machine available to deploy",
                            IsSuccess = false
                        });
                    }

                    TargetServerId = bestPerformanceHost.ServerId;
                }
                else
                {
                    // trước khi gọi sang upload xóa hết cache các instance đang chạy
                    List<string> RunningInstanceKeys = redisHelper.GetKeysByPattern($"{RedisConfigs.RedisStartedChallengeKey}_{challengeId}_*");
                    foreach (var key in RunningInstanceKeys)
                    {
                        await redisHelper.RemoveCacheAsync(key);
                    }

                    redisGetDeployInfo.LastDeployTime = null;

                    await redisHelper.SetCacheAsync<DeploymentInfo>(redisDeployKey, redisGetDeployInfo, TimeSpan.FromDays(90));

                    TargetServerId = redisGetDeployInfo.ServerId;
                }

                var challengeHostServer = ControlCenterServiceConfig.ChallengeServerInfoList.FirstOrDefault(c => c.ServerId == TargetServerId);

                if (challengeHostServer == null) return BadRequest(new GeneralView()
                {
                    Message = "ChallengeHostServer is null, check config machine id",
                    IsSuccess = false
                });

                var UnixTimeDeploy = DateTimeHelper.GetDateTimeNowInUnix();
                var deployrequest = new RestRequest();
                deployrequest.Method = Method.Post;
                deployrequest.Resource = "api/challenge/upload";
                Dictionary<string, string> createScretKeyDictionary = new Dictionary<string, string>
                {
                    { "ChallengeId", challengeId.ToString()},
                };

                string secretkeyDeploy = SecretKeyHelper.CreateSecretKey(UnixTimeDeploy, createScretKeyDictionary);
                deployrequest.AddHeader("SecretKey", secretkeyDeploy);
                using (var memoryStream = new MemoryStream())
                {
                    await file.CopyToAsync(memoryStream);
                    memoryStream.ToArray();
                    deployrequest.AddFile("File", memoryStream.ToArray(), file.FileName, file.ContentType);
                }

                await Console.Out.WriteLineAsync($"Returned for challenge: {challengeId}");

                Dictionary<string, object> requestDeployDictionary = new Dictionary<string, object>
                 {
                        { "UnixTime", UnixTimeDeploy},
                        { "ChallengeId", challengeId},
                 };

                string baseDeployUrl = challengeHostServer.ServerHost + ":" + challengeHostServer.ServerPort;
                MultiServiceConnector multiServiceDeployConnector = new MultiServiceConnector(baseDeployUrl);

                GeneralView? deployResult
                  = await multiServiceDeployConnector.ExecuteRequest<GeneralView>(deployrequest, requestDeployDictionary, RequestContentType.Form);

                await Console.Out.WriteLineAsync(JsonConvert.SerializeObject(deployResult, new JsonSerializerSettings() { ReferenceLoopHandling = ReferenceLoopHandling.Ignore }));

                DeploymentInfo deploymentInfo = new DeploymentInfo()
                {
                    ChallengeId = challengeId,
                    ServerId = challengeHostServer.ServerId,
                    LastDeployTime = DateTime.Now,
                };

                if (deployResult == null || !deployResult.IsSuccess)
                {
                    return BadRequest(new GeneralView
                    {
                        Message = deployResult != null ? deployResult.Message : $"Deploy fail challenge {challengeId}",
                        IsSuccess = false
                    });
                }

                await redisHelper.SetCacheAsync<DeploymentInfo>(redisDeployKey, deploymentInfo, TimeSpan.FromDays(90));

                await Console.Out.WriteLineAsync($"Deployed challenge {challengeId} to server {challengeHostServer.ServerId}");

                return Ok(new GeneralView
                {
                    Message = $"Just waiting deploying challenge ${challengeId}",
                    IsSuccess = true
                });
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync("Error in Upload file: " + ex.Message);
                return BadRequest(new GeneralView
                {
                    Message = ex.InnerException != null ? ex.InnerException.Message : ex.Message,
                    IsSuccess = false
                });
            }

        }

        [HttpPost("delete")]
        public async Task<IActionResult> DeleteChallenge([FromForm] int challengeId)
        {
            await Console.Out.WriteLineAsync($"Received delete request for challenge ID {challengeId}");
            try
            {
                // tao connection redis server 
                RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
                // set gia tri cho redis deploy key
                string redisDeployKey = $"{RedisConfigs.RedisDeployKey}{challengeId}";
                // check key redis deploy ton tai hay khong, get value redis deploy key, 
                var redisGetDeployInfo = await redisHelper.GetFromCacheAsync<DeploymentInfo>(redisDeployKey);

                if (redisGetDeployInfo == null || redisGetDeployInfo.LastDeployTime == null)
                {
                    return Ok(new GeneralView()
                    {
                        Message = $"Deleted",
                        IsSuccess = true
                    });
                }

                var challengeHostServer = ControlCenterServiceConfig.ChallengeServerInfoList.FirstOrDefault(c => c.ServerId == redisGetDeployInfo.ServerId);
                if (challengeHostServer == null)
                {
                    return Ok(new GeneralView()
                    {
                        Message = $"Deleted",
                        IsSuccess = true
                    });
                }

                var deleteRequest = new RestRequest();
                deleteRequest.Method = Method.Post;
                deleteRequest.Resource = "api/challenge/delete";

                long unixTime = DateTimeHelper.GetDateTimeNowInUnix();

                var DictScrKey = new Dictionary<string, string>()
                {
                    {"ChallengeId",challengeId.ToString()}
                };
                var DictMultiService = new Dictionary<string, object>
                {
                    { "UnixTime",unixTime},
                    {"ChallengeId",challengeId }
                };


                if (!DictMultiService.ContainsKey("UnixTime"))
                {
                    DictMultiService.Add("UnixTime", unixTime);
                }

                string secretKeyDeleteChallenge = SecretKeyHelper.CreateSecretKey(unixTime, DictScrKey);

                deleteRequest.AddHeader("SecretKey", secretKeyDeleteChallenge);

                string baseDeployUrl = challengeHostServer.ServerHost + ":" + challengeHostServer.ServerPort;


                MultiServiceConnector connector = new MultiServiceConnector(baseDeployUrl);

                GeneralView? deleteResult
                  = await connector.ExecuteRequest<GeneralView>(deleteRequest, DictMultiService, RequestContentType.Form);

                await Console.Out.WriteLineAsync($"Returned for challenge: {challengeId}");

                await Console.Out.WriteLineAsync($"Delete Result: {JsonConvert.SerializeObject(deleteResult)}");

                if (deleteResult == null || !deleteResult.IsSuccess)
                {
                    return BadRequest(deleteResult);
                }

                //Remove all started challenge key
                List<string> RunningInstanceKeys = redisHelper.GetKeysByPattern($"{RedisConfigs.RedisStartedChallengeKey}_{challengeId}_*");
                foreach (var key in RunningInstanceKeys)
                {
                    await redisHelper.RemoveCacheAsync(key);
                }

                await redisHelper.RemoveCacheAsync(redisDeployKey);

                return Ok(deleteResult);
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync("Error in Delete Challenge: " + ex.Message);
                return BadRequest(new GeneralView
                {
                    Message = ex.InnerException != null ? ex.InnerException.Message : ex.Message,
                    IsSuccess = false
                });
            }
        }

        [HttpPost("start")]
        public async Task<IActionResult> StartInstance([FromHeader] string SecretKey, [FromForm] StartChallengeInstanceRequest instanceInfo)
        {
            await Console.Out.WriteLineAsync($"Received start request for challenge ID {instanceInfo.ChallengeId} - Team {instanceInfo.TeamId}");
            // tao connection redis server 
            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
            int TeamId = instanceInfo.TeamId;
            int ChallengeId = instanceInfo.ChallengeId;

            #region Check cache xem đã có thông tin deployment info của challenge id + team id chưa, nếu có thì trả về luôn không gọi qua

            string StartedCacheKey = $"{RedisConfigs.RedisStartedChallengeKey}_{ChallengeId}_{TeamId}";
            DeploymentInfo? StartedChallengeInfo = await redisHelper.GetFromCacheAsync<DeploymentInfo?>(StartedCacheKey);
            if (StartedChallengeInfo != null)
            {
                return Ok(new GenaralViewResponseData<string>()
                {
                    IsSuccess = true,
                    Message = "Start challenge successfully",
                    data = StartedChallengeInfo.DeploymentDomainName,
                });
            }

            #endregion

            //Phục vụ việc trả về Bad Request
            string ErrorMessage = "Failed to start the challenge. An error occurred during initialization. Please wait a few moments and try again.";
            string DeploymentDomainName = "";
            List<int> StartedChallengeIds = redisHelper.GetKeysByPattern($"{RedisConfigs.RedisStartedChallengeKey}_*_{TeamId}").Select(x => int.Parse(Regex.Match(x, $"(?<={RedisConfigs.RedisStartedChallengeKey}_).*?(?=_{TeamId})").ToString())).ToList();
            await Console.Out.WriteLineAsync(JsonConvert.SerializeObject(redisHelper.GetKeysByPattern($"{RedisConfigs.RedisStartedChallengeKey}_*_{TeamId}")));

            try
            {
                //If TeamId is -1, skip check max instance
                if (TeamId != -1)
                {
                    #region Kiểm tra xem đã max instance được phép chạy đồng thời hay chưa
                    lock (_lock)
                    {
                        if (!TeamDeployQueue.ContainsKey(TeamId))
                        {
                            TeamDeployQueue[TeamId] = new(ServiceConfigs.MaxInstanceAtTime - StartedChallengeIds.Count);
                        }
                    }

                    await Console.Out.WriteLineAsync("TeamDeployQueue[TeamId].CurrentCount: " + TeamDeployQueue[TeamId].CurrentCount.ToString());
                    if (!await TeamDeployQueue[TeamId].WaitAsync(0))
                    {
                        return BadRequest(new GenaralViewResponseData<List<int>>()
                        {
                            Message = $"Each team is allowed to use a maximum of {ServiceConfigs.MaxInstanceAtTime} instances at the same time. Please turn off other instances before starting this challenge.",
                            IsSuccess = false,
                            data = StartedChallengeIds
                        });
                    }
                }
                #endregion

                #region Check xem challenge đã được deploy chưa
                string redisDeployKey = $"{RedisConfigs.RedisDeployKey}{instanceInfo.ChallengeId}";
                var redisGetDeployInfo = await redisHelper.GetFromCacheAsync<DeploymentInfo>(redisDeployKey);
                if (redisGetDeployInfo == null || redisGetDeployInfo.LastDeployTime == null)
                {
                    return BadRequest(new GeneralView
                    {
                        Message = $"Challenge {instanceInfo.ChallengeId} is not yet deployed, can't start",
                        IsSuccess = false
                    });
                }
                #endregion

                #region Tìm Challenge Server đã deploy target challenge 
                var challengeHostServer = ControlCenterServiceConfig.ChallengeServerInfoList.FirstOrDefault(c => c.ServerId == redisGetDeployInfo.ServerId);
                if (challengeHostServer == null)
                {
                    return BadRequest(new GeneralView
                    {
                        Message = "Config of Challenge Hosting Platform in Control Center Platform is invalid, please check then try again",
                        IsSuccess = false
                    });
                }
                #endregion

                #region Call to Challenge Hosting Platform to start challenge
                var startRequest = new RestRequest();
                startRequest.Method = Method.Post;
                startRequest.Resource = "api/challenge/start";

                long unixTime = DateTimeHelper.GetDateTimeNowInUnix();

                var instanceInfoJson = JsonConvert.SerializeObject(instanceInfo);
                var DictScrKey = JsonConvert.DeserializeObject<Dictionary<string, string>>(instanceInfoJson);
                var DictMultiService = JsonConvert.DeserializeObject<Dictionary<string, object>>(instanceInfoJson);

                if (DictScrKey == null || DictMultiService == null)
                {
                    throw new Exception("Convert from obj instance info to dict failed");
                }

                if (!DictMultiService.ContainsKey("UnixTime"))
                {
                    DictMultiService.Add("UnixTime", unixTime);
                }

                string secretKeyStartChallenge = SecretKeyHelper.CreateSecretKey(unixTime, DictScrKey);

                startRequest.AddHeader("SecretKey", secretKeyStartChallenge);

                string baseDeployUrl = challengeHostServer.ServerHost + ":" + challengeHostServer.ServerPort;

                MultiServiceConnector connector = new MultiServiceConnector(baseDeployUrl);

                GenaralViewResponseData<DeploymentInfo>? startResult
                  = await connector.ExecuteRequest<GenaralViewResponseData<DeploymentInfo>>(startRequest, DictMultiService, RequestContentType.Form);

                //await Console.Out.WriteLineAsync($"Returned for challenge: {instanceInfo.ChallengeId}");

                //await Console.Out.WriteLineAsync($"startResult: {JsonConvert.SerializeObject(startResult)}");

                if (startResult == null || !startResult.IsSuccess || startResult.data == null)
                {
                    return BadRequest(startResult);
                }
                #endregion

                DeploymentInfo challengeInstance = startResult.data;
                DeploymentDomainName = challengeInstance.DeploymentDomainName;
                await redisHelper.SetCacheAsync(StartedCacheKey, challengeInstance, TimeSpan.MaxValue);

                #region Commented Code
                //_ = Task.Run(async () =>
                //{
                //    if (challengeInstance.EndTime != null)
                //    {
                //        int delayInMinutes = (int)(challengeInstance.EndTime - DateTime.Now).Value.TotalMilliseconds;
                //        await Task.Delay(delayInMinutes);
                //        var instanceListAtNow = await redisHelper.GetFromCacheAsync<List<DeploymentInfo>>(redisInstanceKey);

                //        if (instanceListAtNow != null && instanceListAtNow.Count > 0)
                //        {
                //            var instance = instanceListAtNow.Where(p => p.ChallengeId == instanceInfo.ChallengeId && p.TeamId == instanceInfo.TeamId).ToList();
                //            instanceListAtNow.RemoveAll(p => p.ChallengeId == instanceInfo.ChallengeId && p.TeamId == instanceInfo.TeamId);
                //            await redisHelper.SetCacheAsync(redisInstanceKey, instanceListAtNow, TimeSpan.MaxValue);
                //        }
                //    }
                //});
                #endregion

                return Ok(new GenaralViewResponseData<string>
                {
                    IsSuccess = true,
                    Message = $"Start challenge successfully",
                    data = DeploymentDomainName,
                });

            }
            catch (Exception ex)
            {
                TeamDeployQueue[TeamId].Release();
                await Console.Out.WriteLineAsync("Error in Start Instance: " + ex.Message);
                if (instanceInfo.TeamId == -1)
                {
                    ErrorMessage = ex.InnerException != null ? ex.InnerException.Message : ex.Message;
                }
                return BadRequest(new GeneralView
                {
                    Message = ErrorMessage,
                    IsSuccess = false
                });
            }
        }

        [HttpPost("stop")]
        public async Task<IActionResult> StopInstance([FromHeader] string SecretKey, [FromForm] StopChallengeInstanceRequest stopInstanceRequest)
        {
            // tao connection redis server 
            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
            string ErrorMessage = "An error occurred while attempting to stop. Please wait a moment and try again.";
            //Xóa bớt hàng chờ deploy (Cái này phục vụ mục đích nếu bấm start quá nhanh sẽ không xly kịp)
            int TeamId = stopInstanceRequest.TeamId;
            int ChallengeId = stopInstanceRequest.ChallengeId;

            lock (_lock)
            {
                if (TeamDeployQueue.ContainsKey(TeamId))
                {
                    TeamDeployQueue[TeamId].Release();
                }
            }

            try
            {
                string redisDeployKey = $"{RedisConfigs.RedisDeployKey}{stopInstanceRequest.ChallengeId}";
                // check key redis deploy ton tai hay khong, get value redis deploy key, 
                var redisGetDeployInfo = await redisHelper.GetFromCacheAsync<DeploymentInfo>(redisDeployKey);
                if (redisGetDeployInfo == null || redisGetDeployInfo.LastDeployTime == null)
                {
                    return BadRequest(new GeneralView()
                    {
                        Message = $"Challenge {stopInstanceRequest.ChallengeId} is not yet deployed, can't stop",
                        IsSuccess = false
                    });
                }

                var challengeHostServer = ControlCenterServiceConfig.ChallengeServerInfoList.FirstOrDefault(c => c.ServerId == redisGetDeployInfo.ServerId);
                if (challengeHostServer == null) return BadRequest(new GeneralView()
                {
                    Message = "ChallengeHostServer is null, check config machine id",
                    IsSuccess = false
                });

                var stopRequest = new RestRequest();
                stopRequest.Method = Method.Post;
                stopRequest.Resource = "api/challenge/stop";

                long unixTime = DateTimeHelper.GetDateTimeNowInUnix();

                var instanceInfoJson = JsonConvert.SerializeObject(stopInstanceRequest);
                var DictScrKey = JsonConvert.DeserializeObject<Dictionary<string, string>>(instanceInfoJson);
                var DictMultiService = JsonConvert.DeserializeObject<Dictionary<string, object>>(instanceInfoJson);

                if (DictScrKey == null || DictMultiService == null)
                {
                    throw new Exception("Convert from obj instance info to dict failed");
                }

                if (!DictMultiService.ContainsKey("UnixTime"))
                {
                    DictMultiService.Add("UnixTime", unixTime);
                }

                string secretKeyStartChallenge = SecretKeyHelper.CreateSecretKey(unixTime, DictScrKey);

                stopRequest.AddHeader("SecretKey", secretKeyStartChallenge);

                string baseDeployUrl = challengeHostServer.ServerHost + ":" + challengeHostServer.ServerPort;
                MultiServiceConnector multiServiceDeployConnector = new MultiServiceConnector(baseDeployUrl);
                GeneralView? stopResult
                  = await multiServiceDeployConnector.ExecuteRequest<GeneralView>(stopRequest, DictMultiService, RequestContentType.Form);

                if (stopResult == null || !stopResult.IsSuccess)
                {
                    return BadRequest(stopResult);
                }

                string StartedCacheKey = $"{RedisConfigs.RedisStartedChallengeKey}_{ChallengeId}_{TeamId}";
                await redisHelper.RemoveCacheAsync(StartedCacheKey);

                return Ok(stopResult);
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync("Error in Stop Instance: " + ex.Message);
                if (stopInstanceRequest.TeamId == -1)
                {
                    ErrorMessage = ex.InnerException != null ? ex.InnerException.Message : ex.Message;
                }

                return BadRequest(new GeneralView
                {
                    Message = ErrorMessage,
                    IsSuccess = false
                });
            }
        }
    }
}
