// @vue/component
export default {
  data() {
    return {
      dragging: false
    }
  },

  methods: {
    onStartDrag() {
      this.dragging = true
    },

    onEndDrag({ oldIndex, newIndex }) {
      this.dragging = false
      if (oldIndex !== newIndex) {
        this.onChange()
      }
    },

    updateOrder(list, schema, draggable) {
      // NOTE: This mixin requires the component to define `this.draggable`.
      // TODO: Rename to a more meaningfull name, e.g. `orderKey` or
      // `orderProperty`.
      const order = draggable?.order
      if (order) {
        // Reorder the changed entries by their order key, taking pagination
        // offsets into account:
        const range = schema === this.schema && this.paginationRange
        const offset = range?.[0] || 0
        for (let i = 0; i < list.length; i++) {
          list[i][order] = i + offset
        }
      }
      return list
    }
  }
}
