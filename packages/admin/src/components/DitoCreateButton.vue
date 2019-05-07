<template lang="pug">
  .dito-create-button
    template(v-if="hasPulldown")
      button.dito-button(
        type="button"
        @mousedown.stop="onPulldownMouseDown()"
        :class="`dito-button-${verb}`"
        :title="labelize(verb)"
      ) {{ text }}
      ul.dito-pulldown(
        :class="{ 'dito-open': pulldown.open }"
      )
        li(v-for="(form, type) in schema.forms")
          a(
            :class="`dito-type-${type}`"
            @mousedown.stop="onPulldownMouseDown(type)"
            @mouseup="onPulldownMouseUp(type)"
          ) {{ getLabel(form) }}
    button.dito-button(
      v-else
      :type="isSingleComponentView ? 'submit' : 'button'"
      @click="createItem()"
      :class="`dito-button-${verb}`"
      :title="labelize(verb)"
    ) {{ text }}
</template>

<style lang="sass">
.dito
  .dito-create-button
    position: relative
    .dito-pulldown
      right: 0
</style>

<script>
import DitoComponent from '@/DitoComponent'
import PulldownMixin from '@/mixins/PulldownMixin'

// @vue/component
export default DitoComponent.component('dito-create-button', {
  mixins: [PulldownMixin],

  props: {
    schema: { type: Object, default: null },
    path: { type: String, required: true },
    verb: { type: String, required: true },
    text: { type: String, default: null }
  },

  computed: {
    hasPulldown() {
      return !!this.schema.forms
    },

    isSingleComponentView() {
      return !!this.viewComponent?.isSingleComponentView
    }
  },

  methods: {
    createItem(form = this.schema.form, type) {
      if (this.schema.inlined) {
        this.sourceComponent.createItem(form, type)
      } else {
        this.$router.push({
          path: `${this.path}/create`,
          query: { type },
          append: true
        })
      }
    },

    onPulldownSelect(type) {
      this.createItem(this.schema.forms[type], type)
      this.showPulldown(false)
    }
  }
})
</script>