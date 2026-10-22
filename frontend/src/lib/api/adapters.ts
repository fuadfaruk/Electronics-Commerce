import { categoryImage } from "@/lib/catalog/visuals";
import type { CategoryDto, ProductDto } from "@/types/api";
import type { Category, Product } from "@/types/domain";

export function apiProductToProduct(dto: ProductDto): Product {
  return { ...dto, compareAtPrice: dto.compareAtPrice ?? undefined };
}

export function apiCategoryToCategory(dto: CategoryDto): Category {
  return { ...dto, image: categoryImage(dto.visualKey) };
}

export function productToDto(product: Product): ProductDto {
  return { ...product, compareAtPrice: product.compareAtPrice ?? null };
}
