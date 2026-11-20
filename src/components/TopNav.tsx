import React from 'react';

export const TopNav = React.memo(function TopNav() {
  return (
    <box flexDirection="row" width="100%" paddingX={1} backgroundColor="gray" paddingY={1}>
      <text>Laneway Domain Manager</text>
      <box flexGrow={1} />
      <text>
        [A]dd | [E]dit | [D]el | [S]ave | E[x]port | [I]mport | [Q]uit
      </text>
    </box>
  );
});
