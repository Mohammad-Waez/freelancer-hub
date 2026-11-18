export class Paginated {
    items;
    meta;
    constructor(items, meta) {
        this.items = items;
        this.meta = meta;
    }
    static of(items, total, page, limit) {
        return new Paginated(items, {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        });
    }
}
//# sourceMappingURL=paginated.js.map