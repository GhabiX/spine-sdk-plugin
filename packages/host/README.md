# Tool metadata

Plugins may include `parameters` (a JSON Schema object) alongside a tool's
`description` and `execute`. `SpinePluginHost.describeTool(name)` returns the
description and a cloned parameters object, without exposing the execute callback.
Unknown or disposed tools throw `SpinePluginHostError` with code `unknown-tool`.

The plugin owns its schema and behavior. Host passes metadata through and does
not validate tool arguments. The caller may validate before `executeTool`;
the tool must still check its runtime constraints. Parameters are optional for
existing plugins. The project Pi composition uses an unconstrained object only
for tools that omit them, and always preserves the plugin's description.
