using System.ComponentModel.DataAnnotations.Schema;

namespace ElectroApi.Core.Entities
{
    public sealed class Category
    {
        public Guid CategoryId { get; set; } = Guid.NewGuid();
        public required string CategorySlug { get; set; }
        public required string CategoryName { get; set; }
        public string? CategoryImageUrl { get; set; }
    }
}

