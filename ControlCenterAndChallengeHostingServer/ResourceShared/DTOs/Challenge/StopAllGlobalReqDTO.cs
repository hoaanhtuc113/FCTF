namespace ResourceShared.DTOs.Challenge
{
    public class StopAllGlobalReqDTO
    {
        public int? userId { get; set; }
        public string? unixTime { get; set; }

        /// <summary>
        /// Must exactly equal DeployService.StopAllGlobalConfirmationPhrase.
        /// A deliberate, hard-to-send-by-accident confirmation that this
        /// call really means to stop every running contest's challenges,
        /// not just one - separate from the contest-scoped /stop-all.
        /// </summary>
        public string? confirm { get; set; }
    }
}
