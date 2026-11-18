export interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}
export declare class Paginated<T> {
    readonly items: T[];
    readonly meta: PaginationMeta;
    constructor(items: T[], meta: PaginationMeta);
    static of<T>(items: T[], total: number, page: number, limit: number): Paginated<T>;
}
