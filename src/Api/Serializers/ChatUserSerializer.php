<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Xelson\Chat\Api\Serializers;

use Flarum\User\User;
use Xelson\Chat\Chat;

class ChatUserSerializer extends ChatSerializer
{
    /**
     * Get the default set of serialized attributes for a model.
     *
     * @param object|array $model
     * @return array
     */
    protected function getDefaultAttributes($chat): array
    {
        $attributes = $chat->getAttributes();
		if($chat->created_at) $attributes['created_at'] = $this->formatDate($chat->created_at);
		
		// +++ 权限修复 (瑕疵 3) +++
        // 原始代码:
		// $chatUser = $chat->getChatUser($this->actor); // <--- 这是“自动加入”漏洞
        //
        // 修复：
        // 必须使用“安全”的 getMembership 方法
        $chatUser = $chat->getMembership($this->actor);
        // +++ 修复结束 +++
		if($chatUser)
		{
            $attributes['role'] = $chatUser->role;
			$attributes['joined_at'] = $this->formatDate($chatUser->joined_at);
			$attributes['readed_at'] = $this->formatDate($chatUser->readed_at);
			$attributes['removed_at'] = $this->formatDate($chatUser->removed_at);
			$attributes['removed_by'] = $chatUser->removed_by;
            $attributes['unreaded'] = $chat->unreadedCount($chatUser);
        }

        return $attributes;
    }
}
