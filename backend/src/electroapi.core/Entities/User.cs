using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.Entities
{
    public sealed class User
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
    }
}
