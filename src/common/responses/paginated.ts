export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}

  static of<T>(items: T[], total: number, page: number, limit: number) {
    return new Paginated(items, {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  }
}