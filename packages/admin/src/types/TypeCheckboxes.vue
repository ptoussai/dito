<template lang="pug">
  ul.dito-checkboxes(
    :id="dataPath"
    :class="`dito-layout-${schema.layout || 'vertical'}`"
  )
    li(v-for="option in options")
      label
        input.dito-checkbox(
          ref="element"
          type="checkbox"
          :value="getValueForOption(option)"
          v-model="selectedValue"
          v-bind="attributes"
          v-on="listeners"
        )
        | {{ getLabelForOption(option) }}
</template>

<style lang="sass">
  .dito-checkboxes
    label
      @extend %input-borderless
    .dito-checkbox
      margin-right: $form-spacing
</style>

<script>
import TypeComponent from '@/TypeComponent'
import OptionsMixin from '@/mixins/OptionsMixin'

// @vue/component
export default TypeComponent.register('checkboxes', {
  mixins: [OptionsMixin],

  nativeField: true,
  defaultValue: []
})
</script>
