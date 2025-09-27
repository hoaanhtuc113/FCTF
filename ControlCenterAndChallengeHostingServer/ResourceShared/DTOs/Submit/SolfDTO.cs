using ResourceShared.Models;

namespace ResourceShared.DTOs.Submit
{
    public class SolfDTO
    {
        public int Id { get; set; }

        public int? ChallengeId { get; set; }
        public int? UserId { get; set; }

        public int? TeamId { get; set; }

        public int? AccountId { get; set; }

        public virtual ResourceShared.Models.Challenge? Challenge { get; set; }

        public virtual Submission IdNavigation { get; set; } = null!;
        public virtual ResourceShared.Models.Team? Team { get; set; }

        public virtual ResourceShared.Models.User? User { get; set; }
    }
}
