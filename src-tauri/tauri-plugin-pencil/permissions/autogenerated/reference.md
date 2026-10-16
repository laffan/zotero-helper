## Default Permission

Default permissions: allow JS to subscribe to and unsubscribe from the Pencil's events, and to dismiss the system's text-selection menu.

#### This default permission set includes the following:

- `allow-register-listener`
- `allow-remove-listener`
- `allow-hide-edit-menu`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`pencil:allow-hide-edit-menu`

</td>
<td>

Enables the hide_edit_menu command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`pencil:deny-hide-edit-menu`

</td>
<td>

Denies the hide_edit_menu command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`pencil:allow-register-listener`

</td>
<td>

Allow JS to register a listener for the Pencil's events (tap / squeeze) via addPluginListener().

</td>
</tr>

<tr>
<td>

`pencil:allow-remove-listener`

</td>
<td>

Allow JS to remove a previously registered plugin-event listener.

</td>
</tr>

<tr>
<td>

`pencil:allow-hide-edit-menu`

</td>
<td>

Allow JS to dismiss the system's text-selection menu over a selection in the PDF.

</td>
</tr>
</table>
