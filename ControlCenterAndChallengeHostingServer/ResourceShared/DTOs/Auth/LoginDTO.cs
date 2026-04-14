using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Auth
{
    public class LoginDTO
    {
        public string? username { get; set; }
        public string? password { get; set; }
        public string? captchaToken { get; set; }
    }
}
