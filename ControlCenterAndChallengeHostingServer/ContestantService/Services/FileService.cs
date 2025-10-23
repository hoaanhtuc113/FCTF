using ContestantService.Interfaces;
using ContestantService.Utils;

namespace ContestantService.Services
{
    public class FileService : IFileService
    {
        private readonly string _nfsMountPath;
        public FileService(ILogger<FileService> logger)
        {
            _nfsMountPath = ContestantServiceConfigHelper.NFS_MOUNT_PATH;
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
        public async Task<FileResult> GetFileAsync(string path)
        {
            try
            {
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

                // Check if file exists
                if (!File.Exists(fullPath))
                {
                    return new FileResult
                    {
                        Success = false,
                        Message = "File not found"
                    };
                }

                // Get file info
                var fileInfo = new FileInfo(fullPath);
                var fileName = fileInfo.Name;
                var contentType = GetContentType(fileName);

                // Open file stream
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
                return new FileResult
                {
                    Success = false,
                    Message = $"Error retrieving file: {ex.Message}"
                };
            }
        }

    }
}


