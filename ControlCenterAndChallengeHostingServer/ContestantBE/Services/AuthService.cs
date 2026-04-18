using ContestantBE.Interfaces;
using ContestantBE.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using ResourceShared.Utils;
using ResourceShared.Logger;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ContestantBE.Services;

public class AuthService : IAuthService
{
    private static readonly string _dummyPasswordHash = SHA256Helper.HashPasswordPythonStyle("fctf-dummy-password");
    private const string PasswordSpecialCharacters = "!@#$%^&*(),.?\":{}|<>";
    private const string TurnstileVerifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private readonly AppDbContext _context;
    private readonly TokenHelper _tokenHelper;
    private readonly UserHelper _userHelper;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly AppLogger _logger;
    private readonly RedisHelper _redisHelper;
    private readonly RedisLockHelper _redisLockHelper;
    private readonly ConfigHelper _configHelper;
    public AuthService(
        AppDbContext context,
        TokenHelper tokenHelper,
        UserHelper userHelper,
        IHttpContextAccessor httpContextAccessor,
        IHttpClientFactory httpClientFactory,
        AppLogger logger,
        RedisHelper redisHelper,
        RedisLockHelper redisLockHelper,
        ConfigHelper configHelper)
    {
        _context = context;
        _tokenHelper = tokenHelper;
        _userHelper = userHelper;
        _httpContextAccessor = httpContextAccessor;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _redisHelper = redisHelper;
        _redisLockHelper = redisLockHelper;
        _configHelper = configHelper;
    }

    private static void RunFakeHash(string? password)
    {
        try
        {
            _ = SHA256Helper.VerifyPassword(password ?? string.Empty, _dummyPasswordHash);
        }
        catch
        {
            // Intentionally ignore to keep behavior timing-oriented only.
        }
    }

    private static bool IsValidPasswordPolicy(string password)
    {
        return password.Length >= 8
            && password.Length <= 20
            && password.Any(char.IsUpper)
            && password.Any(char.IsLower)
            && password.Any(char.IsDigit)
            && password.Any(c => PasswordSpecialCharacters.Contains(c));
    }

    private static string? NormalizeNullable(string? value)
    {
        if (value == null)
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static Dictionary<int, JsonElement?> BuildFieldValueMap(IEnumerable<RegistrationFieldValueDTO>? values)
    {
        var map = new Dictionary<int, JsonElement?>();
        if (values == null)
        {
            return map;
        }

        foreach (var value in values)
        {
            if (value.fieldId <= 0)
            {
                continue;
            }

            map[value.fieldId] = value.value;
        }

        return map;
    }

    private static bool HasFieldValue(JsonElement? rawValue)
    {
        if (!rawValue.HasValue)
        {
            return false;
        }

        var element = rawValue.Value;
        if (element.ValueKind == JsonValueKind.Null || element.ValueKind == JsonValueKind.Undefined)
        {
            return false;
        }

        if (element.ValueKind == JsonValueKind.String)
        {
            return !string.IsNullOrWhiteSpace(element.GetString());
        }

        return true;
    }

    private static string? ReadTextValue(JsonElement? rawValue)
    {
        if (!rawValue.HasValue)
        {
            return null;
        }

        var element = rawValue.Value;
        return element.ValueKind switch
        {
            JsonValueKind.String => NormalizeNullable(element.GetString()),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => element.GetRawText(),
            JsonValueKind.Null => null,
            JsonValueKind.Undefined => null,
            _ => NormalizeNullable(element.GetRawText())
        };
    }

    private static bool TryReadBoolean(JsonElement? rawValue, out bool parsedValue)
    {
        parsedValue = false;
        if (!rawValue.HasValue)
        {
            return false;
        }

        var element = rawValue.Value;
        switch (element.ValueKind)
        {
            case JsonValueKind.True:
                parsedValue = true;
                return true;
            case JsonValueKind.False:
                parsedValue = false;
                return true;
            case JsonValueKind.Number:
                if (element.TryGetInt32(out var numberValue))
                {
                    if (numberValue == 1)
                    {
                        parsedValue = true;
                        return true;
                    }

                    if (numberValue == 0)
                    {
                        parsedValue = false;
                        return true;
                    }
                }
                return false;
            case JsonValueKind.String:
                var normalized = NormalizeNullable(element.GetString())?.ToLowerInvariant();
                if (normalized == null)
                {
                    return false;
                }

                if (normalized is "true" or "1" or "yes" or "y" or "on")
                {
                    parsedValue = true;
                    return true;
                }

                if (normalized is "false" or "0" or "no" or "n" or "off")
                {
                    parsedValue = false;
                    return true;
                }

                return false;
            default:
                return false;
        }
    }

    private static string NormalizeFieldType(string? fieldType)
    {
        return string.Equals(fieldType, "boolean", StringComparison.OrdinalIgnoreCase)
            ? "boolean"
            : "text";
    }

    private bool IsContestantRegistrationEnabled()
    {
        return _configHelper.GetConfig<bool>("contestant_registration_enabled", false);
    }

    private sealed class TurnstileVerifyResponse
    {
        public bool success { get; set; }

        [JsonPropertyName("error-codes")]
        public List<string>? errorCodes { get; set; }
    }

    private async Task<bool> ValidateCaptchaTokenAsync(string? captchaToken)
    {
        if (!ContestantBEConfigHelper.IsTurnstileEnabled)
        {
            return true;
        }

        var normalizedCaptchaToken = NormalizeNullable(captchaToken);
        if (normalizedCaptchaToken == null)
        {
            return false;
        }

        try
        {
            var payload = new Dictionary<string, string>
            {
                ["secret"] = ContestantBEConfigHelper.CLOUDFLARE_TURNSTILE_SECRET_KEY,
                ["response"] = normalizedCaptchaToken,
            };

            var requestIp = _userHelper.GetIP(_httpContextAccessor.HttpContext!);
            var normalizedRequestIp = NormalizeNullable(requestIp);
            if (normalizedRequestIp != null)
            {
                payload["remoteip"] = normalizedRequestIp;
            }

            using var request = new HttpRequestMessage(HttpMethod.Post, TurnstileVerifyUrl)
            {
                Content = new FormUrlEncodedContent(payload),
            };

            var httpClient = _httpClientFactory.CreateClient();
            using var verifyTimeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var response = await httpClient.SendAsync(request, verifyTimeoutCts.Token);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Turnstile verification failed due to upstream status", new
                {
                    responseStatus = (int)response.StatusCode,
                });
                return false;
            }

            await using var responseStream = await response.Content.ReadAsStreamAsync(verifyTimeoutCts.Token);
            var verifyResponse = await JsonSerializer.DeserializeAsync<TurnstileVerifyResponse>(responseStream, cancellationToken: verifyTimeoutCts.Token);
            if (verifyResponse?.success == true)
            {
                return true;
            }

            _logger.LogDebug("Turnstile verification rejected", new
            {
                verifyResponse?.errorCodes,
            });

            return false;
        }
        catch (OperationCanceledException)
        {
            _logger.LogDebug("Turnstile verification timed out");
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex);
            return false;
        }
    }

    public async Task<BaseResponseDTO<RegistrationMetadataDTO>> GetRegistrationMetadata()
    {
        try
        {
            if (!IsContestantRegistrationEnabled())
            {
                return BaseResponseDTO<RegistrationMetadataDTO>.Fail("Registration is currently disabled");
            }

            var userFields = await _context.Fields
                .AsNoTracking()
                .Where(f => f.Type == "user")
                .OrderBy(f => f.Id)
                .Select(f => new RegistrationFieldDefinitionDTO
                {
                    id = f.Id,
                    name = f.Name ?? string.Empty,
                    description = f.Description,
                    fieldType = NormalizeFieldType(f.FieldType),
                    required = f.Required == true,
                })
                .ToListAsync();

            var metadata = new RegistrationMetadataDTO
            {
                userFields = userFields,
                constraints = new RegistrationConstraintsDTO
                {
                    numUsersLimit = _configHelper.GetConfig("num_users", 0),
                },
            };

            return BaseResponseDTO<RegistrationMetadataDTO>.Ok(metadata, "Registration metadata loaded");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex);
            return BaseResponseDTO<RegistrationMetadataDTO>.Fail("Unable to load registration metadata");
        }
    }

    public async Task<BaseResponseDTO<string>> RegisterContestant(RegisterContestantDTO registerContestantDto)
    {
        const string registrationLimitLockKey = "auth:register:num-users-limit";
        var registrationLimitLockToken = Guid.NewGuid().ToString("N");
        var registrationLimitLockAcquired = false;

        try
        {
            if (!IsContestantRegistrationEnabled())
            {
                return BaseResponseDTO<string>.Fail("Registration is currently disabled");
            }

            var captchaValid = await ValidateCaptchaTokenAsync(registerContestantDto.captchaToken);
            if (!captchaValid)
            {
                return BaseResponseDTO<string>.Fail("Captcha validation failed");
            }

            var username = NormalizeNullable(registerContestantDto.username);
            var email = NormalizeNullable(registerContestantDto.email);
            var password = registerContestantDto.password?.Trim() ?? string.Empty;
            var confirmPassword = registerContestantDto.confirmPassword?.Trim() ?? string.Empty;
            if (username == null || email == null || string.IsNullOrEmpty(password) || string.IsNullOrEmpty(confirmPassword))
            {
                return BaseResponseDTO<string>.Fail("Username, email, password, and confirm password are required");
            }

            if (!string.Equals(password, confirmPassword, StringComparison.Ordinal))
            {
                return BaseResponseDTO<string>.Fail("Password confirmation does not match");
            }

            if (!IsValidPasswordPolicy(password))
            {
                return BaseResponseDTO<string>.Fail("Password must be 8-20 characters and include uppercase, lowercase, number, and special character");
            }

            var numUsersLimit = _configHelper.GetConfig("num_users", 0);
            if (numUsersLimit > 0)
            {
                registrationLimitLockAcquired = await _redisLockHelper.AcquireWithRetry(
                    registrationLimitLockKey,
                    registrationLimitLockToken,
                    TimeSpan.FromSeconds(10),
                    retry: 8,
                    delayMs: 100);
                if (!registrationLimitLockAcquired)
                {
                    return BaseResponseDTO<string>.Fail("Registration is busy, please try again");
                }

                var currentUsers = await _context.Users
                    .AsNoTracking()
                    .CountAsync(u => u.Banned != true && u.Hidden != true);
                if (currentUsers + 1 > numUsersLimit)
                {
                    return BaseResponseDTO<string>.Fail($"Reached the maximum number of users ({numUsersLimit})");
                }
            }

            var usernameExists = await _context.Users
                .AsNoTracking()
                .AnyAsync(u => u.Name == username);
            if (usernameExists)
            {
                return BaseResponseDTO<string>.Fail($"Username has already been taken: {username}");
            }

            var emailExists = await _context.Users
                .AsNoTracking()
                .AnyAsync(u => u.Email == email);
            if (emailExists)
            {
                return BaseResponseDTO<string>.Fail($"Email address has already been used: {email}");
            }

            var userFieldDefinitions = await _context.Fields
                .AsNoTracking()
                .Where(f => f.Type == "user")
                .OrderBy(f => f.Id)
                .ToListAsync();

            var userFieldMap = BuildFieldValueMap(registerContestantDto.userFields);
            var userFieldEntries = new List<FieldEntry>();
            foreach (var field in userFieldDefinitions)
            {
                var hasValue = userFieldMap.TryGetValue(field.Id, out var rawValue) && HasFieldValue(rawValue);
                if (field.Required == true && !hasValue)
                {
                    return BaseResponseDTO<string>.Fail($"User field '{field.Name}' is required");
                }

                if (!hasValue)
                {
                    continue;
                }

                var fieldType = NormalizeFieldType(field.FieldType);
                if (fieldType == "boolean")
                {
                    if (!TryReadBoolean(rawValue, out var booleanValue))
                    {
                        return BaseResponseDTO<string>.Fail($"User field '{field.Name}' must be a boolean value");
                    }

                    if (field.Required == true && booleanValue != true)
                    {
                        return BaseResponseDTO<string>.Fail($"User field '{field.Name}' must be accepted");
                    }

                    userFieldEntries.Add(new FieldEntry
                    {
                        Type = "user",
                        FieldId = field.Id,
                        Value = JsonSerializer.Serialize(booleanValue),
                    });

                    continue;
                }

                var textValue = ReadTextValue(rawValue);
                if (field.Required == true && textValue == null)
                {
                    return BaseResponseDTO<string>.Fail($"User field '{field.Name}' is required");
                }

                if (textValue == null)
                {
                    continue;
                }

                userFieldEntries.Add(new FieldEntry
                {
                    Type = "user",
                    FieldId = field.Id,
                    Value = JsonSerializer.Serialize(textValue),
                });
            }

            await using var transaction = await _context.Database.BeginTransactionAsync();

            var user = new User
            {
                Name = username,
                Email = email,
                Password = SHA256Helper.HashPasswordPythonStyle(password),
                Type = ResourceShared.Enums.UserType.User,
                Verified = false,
                Hidden = false,
                Banned = false,
                TeamId = null,
                Created = DateTime.UtcNow,
            };

            _context.Users.Add(user);

            await _context.SaveChangesAsync();

            if (user.Id <= 0)
            {
                throw new DbUpdateException("Failed to create user before saving registration fields");
            }

            foreach (var fieldEntry in userFieldEntries)
            {
                fieldEntry.UserId = user.Id;
                fieldEntry.User = user;
            }

            if (userFieldEntries.Count > 0)
            {
                _context.FieldEntries.AddRange(userFieldEntries);
                await _context.SaveChangesAsync();
            }

            await transaction.CommitAsync();

            return BaseResponseDTO<string>.Ok("Registration submitted. Your account is pending verification.", "Registration submitted");
        }
        catch (DbUpdateException ex)
        {
            var dbError = ex.GetBaseException().Message;
            _logger.LogError(ex, data: new { registerContestantDto.username, dbError });

            if (dbError.Contains("Duplicate", StringComparison.OrdinalIgnoreCase))
            {
                return BaseResponseDTO<string>.Fail("A duplicated username or email was detected");
            }

            if (dbError.Contains("json_valid", StringComparison.OrdinalIgnoreCase)
                || dbError.Contains("field_entries", StringComparison.OrdinalIgnoreCase))
            {
                return BaseResponseDTO<string>.Fail("Invalid registration field data");
            }

            return BaseResponseDTO<string>.Fail("Unable to submit registration");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { registerContestantDto.username });
            return BaseResponseDTO<string>.Fail("Unable to submit registration");
        }
        finally
        {
            if (registrationLimitLockAcquired)
            {
                try
                {
                    await _redisLockHelper.ReleaseLock(registrationLimitLockKey, registrationLimitLockToken);
                }
                catch
                {
                    // ignore lock release errors
                }
            }
        }
    }

    public async Task<BaseResponseDTO<AuthResponseDTO>> LoginContestant(LoginDTO loginDto)
    {
        try
        {
            // Trim input fields
            loginDto.username = loginDto.username?.Trim();
            loginDto.password = loginDto.password?.Trim();

            if (string.IsNullOrEmpty(loginDto.username) || string.IsNullOrEmpty(loginDto.password))
            {
                RunFakeHash(loginDto.password);
                return BaseResponseDTO<AuthResponseDTO>.Fail("Missing username or password");
            }

            var captchaValid = await ValidateCaptchaTokenAsync(loginDto.captchaToken);
            if (!captchaValid)
            {
                RunFakeHash(loginDto.password);
                return BaseResponseDTO<AuthResponseDTO>.Fail("Captcha validation failed");
            }

            // load tracked entity so we can update password if we migrate hash format
            var user = await _context.Users
                .Include(t => t.Team)
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Name == loginDto.username);

            // Always do one password verify operation to reduce response-time variance.
            var passwordHashToVerify = string.IsNullOrWhiteSpace(user?.Password)
                ? _dummyPasswordHash
                : user.Password;
            var passwordValid = SHA256Helper.VerifyPassword(loginDto.password, passwordHashToVerify);
            
            if (user == null || user.Type != "user")
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Invalid username or password");
            }

            if(user.Verified == false)
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Your account is not verified yet");
            }

            if (!passwordValid || user.Type != "user")
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Invalid username or password");
            }
            if ((user.Hidden ?? false) || (user.Banned ?? false))
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Your account is not allowed");
            }
            if (user.Team == null)
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("You don't have a team yet");
            }
            if (user.Team != null && (user.Team.Banned ?? false))
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Your team has been banned");
            }
            var dateTime = DateTime.Now.AddDays(1);
            var jwt = await _tokenHelper.GenerateUserToken(user, dateTime, "Login token");

            // Kiểm tra xem user đã có tracking với IP này chưa
            var userIp = _userHelper.GetIP(_httpContextAccessor.HttpContext!);
            var existingTracking = await _context.Trackings
                .FirstOrDefaultAsync(t => t.UserId == user.Id && t.Ip == userIp);

            if (existingTracking != null)
            {
                // Update date nếu đã có
                existingTracking.Date = DateTime.Now;
                _context.Trackings.Update(existingTracking);
            }
            else
            {
                // Tạo tracking mới
                var tracking = new Tracking
                {
                    Type = null,
                    Ip = userIp,
                    UserId = user.Id,
                    Date = DateTime.Now
                };
                _context.Trackings.Add(tracking);
            }

            await _context.SaveChangesAsync();

            // Invalidate cached auth info for this user so middleware reads fresh token UUID
            try
            {
                var cacheKey = $"auth:user:{user.Id}";
                _ = await _redisHelper.RemoveCacheAsync(cacheKey);
            }
            catch
            {
                // ignore cache errors
            }

            var authResponse = new AuthResponseDTO
            {
                id = user.Id,
                username = user.Name ?? string.Empty,
                email = user.Email ?? string.Empty,
                team = user.Team == null
                    ? null
                    : new TeamResponse
                    {
                        id = user.Team.Id,
                        teamName = user.Team.Name ?? string.Empty
                    },
                token = jwt
            };

            return BaseResponseDTO<AuthResponseDTO>.Ok(authResponse, "Login successful");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { loginDto.username });
            return BaseResponseDTO<AuthResponseDTO>.Fail("An error occurred during login");
        }
    }

    public async Task<BaseResponseDTO<string>> ChangePassword(int userId, ChangePasswordDTO changePasswordDto)
    {
        try
        {
            // Trim input fields
            changePasswordDto.oldPassword = changePasswordDto.oldPassword?.Trim();
            changePasswordDto.newPassword = changePasswordDto.newPassword?.Trim();
            changePasswordDto.confirmPassword = changePasswordDto.confirmPassword?.Trim();

            // Validate input
            if (string.IsNullOrEmpty(changePasswordDto.oldPassword) ||
            string.IsNullOrEmpty(changePasswordDto.newPassword) ||
            string.IsNullOrEmpty(changePasswordDto.confirmPassword))
            {
                return BaseResponseDTO<string>.Fail("All password fields are required");
            }

            // Check if new password matches confirm password
            if (changePasswordDto.newPassword != changePasswordDto.confirmPassword)
            {
                return BaseResponseDTO<string>.Fail("New password and confirm password do not match");
            }

            if (string.Equals(changePasswordDto.oldPassword, changePasswordDto.newPassword, StringComparison.Ordinal))
            {
                return BaseResponseDTO<string>.Fail("New password must be different from current password");
            }

            if (!IsValidPasswordPolicy(changePasswordDto.newPassword))
            {
                return BaseResponseDTO<string>.Fail("New password must be 8-20 characters and include uppercase, lowercase, number, and special character");
            }

            // Get user from database
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);

            if (user == null)
            {
                return BaseResponseDTO<string>.Fail("User not found");
            }

            // Verify old password (v2-only)
            if (!SHA256Helper.VerifyPassword(changePasswordDto.oldPassword, user.Password))
            {
                return BaseResponseDTO<string>.Fail("Old password is incorrect");
            }

            // Hash new password (v2) and update
            user.Password = SHA256Helper.HashPasswordPythonStyle(changePasswordDto.newPassword);

            await _context.SaveChangesAsync();

            return BaseResponseDTO<string>.Ok("Password changed successfully", "Password changed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId);
            return BaseResponseDTO<string>.Fail("An error occurred while changing password");
        }
    }

    public async Task<BaseResponseDTO<string>> Logout(int userId)
    {
        try
        {
            var existingTokens = await _context.Tokens
                .Where(t => t.UserId == userId && t.Type == ResourceShared.Enums.UserType.User)
                .ToListAsync();

            if (existingTokens.Count > 0)
            {
                _context.Tokens.RemoveRange(existingTokens);
                await _context.SaveChangesAsync();
            }

            try
            {
                var cacheKey = $"auth:user:{userId}";
                _ = await _redisHelper.RemoveCacheAsync(cacheKey);
            }
            catch
            {
                // ignore cache errors
            }

            return BaseResponseDTO<string>.Ok("Logged out successfully", "Logged out successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId);
            return BaseResponseDTO<string>.Fail("An error occurred during logout");
        }
    }
}
