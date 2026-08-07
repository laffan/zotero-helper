## Default Permission

Default permissions: allow JS to subscribe to and unsubscribe from capture events. All actions (open/close/bounds/back/grab) are driven from the Rust core.

#### This default permission set includes the following:

- `allow-register-listener`
- `allow-remove-listener`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`capture-view:allow-register-listener`

</td>
<td>

Allow JS to register a listener for this plugin's events (captured / navigated / failed) via addPluginListener().

</td>
</tr>

<tr>
<td>

`capture-view:allow-remove-listener`

</td>
<td>

Allow JS to remove a previously registered plugin-event listener.

</td>
</tr>
</table>
