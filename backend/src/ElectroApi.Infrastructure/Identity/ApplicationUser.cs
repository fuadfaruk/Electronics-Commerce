using Microsoft.AspNetCore.Identity;

namespace ElectroApi.Infrastructure.Identity;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
