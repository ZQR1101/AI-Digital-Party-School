/**
 * 按允许的组织 ID 集合过滤组织树（书记等受限角色使用）。
 * 规则：
 * - 命中节点的整棵子树保留（可管理范围 + 其后代）；
 * - 未命中节点若其后代命中，则保留该祖先路径（保证树形 UI 可逐级展开到可管理节点）；
 * - 其余分支剪除。
 */
function filterTreeByAllowedIds(nodes, allowed) {
  const allowedIds = allowed instanceof Set ? allowed : new Set((allowed || []).map(Number));
  return (nodes || []).reduce((kept, node) => {
    if (allowedIds.has(Number(node.id))) {
      kept.push({ ...node });
    } else if (node.children) {
      const matchedChildren = filterTreeByAllowedIds(node.children, allowedIds);
      if (matchedChildren.length) kept.push({ ...node, children: matchedChildren });
    }
    return kept;
  }, []);
}

module.exports = filterTreeByAllowedIds;
