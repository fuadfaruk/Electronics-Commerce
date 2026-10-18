using System;
using System.Collections.Generic;
using System.Text;

namespace ElectroApi.Core.Entities
{
    public sealed class User
    {
        public Guid UserId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
    }
}
