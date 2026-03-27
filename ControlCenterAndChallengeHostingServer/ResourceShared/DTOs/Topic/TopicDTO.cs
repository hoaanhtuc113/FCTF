using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Topic
{
    public class TopicDTO
    {
        public string topic_name { get; set; }
        public int challenge_count { get; set; }
        public bool cleared { get; set; }
    }
}
