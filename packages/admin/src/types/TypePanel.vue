<script>
import TypeComponent from '@/TypeComponent'

// @vue/component
export default TypeComponent.register('panel', {
  defaultValue: undefined,
  generateLabel: false,
  omitPadding: true,

  getPanelSchema(schema) {
    // For a TypePanel, the component schema is also the panel schema, but
    // remove the added name, so it doesn't get appended twice to data-path.
    const { name, ...panel } = schema
    return panel
  }
})
</script>
