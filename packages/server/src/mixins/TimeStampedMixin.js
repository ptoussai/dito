export const TimeStampedMixin = Model => class extends Model {
  static properties = {
    createdAt: {
      type: 'timestamp',
      default: 'now()'
    },
    updatedAt: {
      type: 'timestamp',
      default: 'now()'
    }
  }

  static scopes = {
    timeStamped: query => query
      .select('createdAt', 'updatedAt')
  }

  $beforeInsert(ctx) {
    this.createdAt = this.updatedAt = new Date()
    return super.$beforeInsert(ctx)
  }

  $beforeUpdate(opt, ctx) {
    this.updatedAt = new Date()
    return super.$beforeUpdate(opt, ctx)
  }
}