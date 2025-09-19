using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Models
{
    public class RabbitMqOptions
    {
        public string Host { get; set; }
        public string VirtualHost { get; set; } = "/";
        public string Username { get; set; }
        public string Password { get; set; }
        public int Port { get; set; }   
    }
}
