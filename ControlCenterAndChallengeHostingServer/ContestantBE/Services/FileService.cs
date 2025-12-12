using ContestantBE.Interfaces;
using ContestantBE.Utils;
using ResourceShared.DTOs.File;
using ResourceShared.Models;
using ResourceShared.Utils;
using ResourceShared.Logger;

namespace ContestantBE.Services
{
    public class FileService : IFileService
    {
        private readonly string _nfsMountPath;
        private readonly AppDbContext _context;
        private readonly AppLogger _logger;
        public FileService(AppDbContext context, AppLogger logger)
        {
            _nfsMountPath = ContestantBEConfigHelper.NFS_MOUNT_PATH;
            _context = context;
            _logger = logger;
        }

        private string GetContentType(string fileName)
        {
            var extension = Path.GetExtension(fileName).ToLowerInvariant();
            return extension switch
            {
                ".txt" => "text/plain",
                ".pdf" => "application/pdf",
                ".doc" => "application/vnd.ms-word",
                ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".xls" => "application/vnd.ms-excel",
                ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".gif" => "image/gif",
                ".csv" => "text/csv",
                ".zip" => "application/zip",
                ".tar" => "application/x-tar",
                ".gz" => "application/gzip",
                _ => "application/octet-stream"
            };
        }
        public async Task<FileResult> GetFileAsync(string path, string token, int user_id)
        {
            try
            {
                var file = _context.Files.Where(f => f.Location == path).FirstOrDefault();
                var fileToken = ItsDangerousCompatHelper.Loads<FileTokenDTOs>(token);

                if (fileToken == null || fileToken.user_id != user_id)
                {
                    await Console.Out.WriteLineAsync("Token validation failed - user_id mismatch");
                    return new FileResult
                    {
                        Success = false,
                        Message = "Invalid or expired token"
                    };
                }
                if (string.IsNullOrWhiteSpace(path))
                {
                    return new FileResult
                    {
                        Success = false,
                        Message = "File path is required"
                    };
                }

                var fullPath = Path.GetFullPath(Path.Combine(_nfsMountPath, path));

                if (!fullPath.StartsWith(_nfsMountPath, StringComparison.OrdinalIgnoreCase))
                {
                    return new FileResult
                    {
                        Success = false,
                        Message = "Invalid file path"
                    };
                }

                if (!System.IO.File.Exists(fullPath))
                {
                    await Console.Out.WriteLineAsync($"File does not exist at: {fullPath}");
                    return new FileResult
                    {
                        Success = false,
                        Message = "File not found"
                    };
                }

                var fileInfo = new FileInfo(fullPath);
                var fileName = fileInfo.Name;
                var contentType = GetContentType(fileName);

                var fileStream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, true);

                return new FileResult
                {
                    Success = true,
                    FileStream = fileStream,
                    FileName = fileName,
                    ContentType = contentType
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, user_id, data: new { path, token });
                return new FileResult
                {
                    Success = false,
                    Message = $"Error retrieving file: {ex.Message}"
                };
            }
        }

    }
}


