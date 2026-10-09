using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class AttemptDTO
    {
        public bool status { get; set; }
        public bool configuration_error { get; set; }
        public string? message { get; set; }
    }
}
