using System;
using System.Collections.Generic;
using System.Text;

namespace electroapi.core.DTOs
{
    public class CreateProductRequest
    {
        public string ProductName { get; set; } = string.Empty;
        public string ProductDescription { get; set; } = string.Empty;
        public int ProductPrice { get; set; }
        public int ProductQuantity { get; set; }
    }
}
