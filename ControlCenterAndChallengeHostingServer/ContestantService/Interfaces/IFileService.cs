namespace ContestantService.Interfaces
{
    public interface IFileService
    {
        Task<FileResult> GetFileAsync(string path);
    }

    public class FileResult
    {
        public bool Success { get; set; }
        public string? Message { get; set; }
        public Stream? FileStream { get; set; }
        public string? FileName { get; set; }
        public string? ContentType { get; set; }
    }
}
