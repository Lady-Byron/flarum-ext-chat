<?php

namespace Xelson\Chat\Api\Serializers;

use Flarum\Api\Serializer\AbstractSerializer;
use Flarum\Api\Serializer\BasicUserSerializer;
use Flarum\Settings\SettingsRepositoryInterface;
use Xelson\Chat\ChatSocket;
use Xelson\Chat\ChatUser;

class MessageSerializer extends AbstractSerializer
{
    protected $type = 'chatmessages';

    protected SettingsRepositoryInterface $settings;
    protected ChatSocket $socket;

    public function __construct(SettingsRepositoryInterface $settings, ChatSocket $socket)
    {
        $this->settings = $settings;
        $this->socket = $socket;
    }

    protected function getDefaultAttributes($message): array
    {
        $attributes = $message->getAttributes();

        // 不暴露 IP
        unset($attributes['ip_address']);

        // 标准时间格式
        if ($message->created_at) {
            $attributes['created_at'] = $this->formatDate($message->created_at);
        }
        if ($message->edited_at) {
            $attributes['edited_at'] = $this->formatDate($message->edited_at);
        }

        // ① 游客整体打码（保留你现有逻辑）
        $censorEnabled = (bool) $this->settings->get('xelson-chat.settings.display.censor');
        $isGuest = !($this->actor && $this->actor->id);
        if ($censorEnabled && $isGuest && isset($attributes['message'])) {
            $attributes['message'] = str_repeat('*', mb_strlen((string) $attributes['message']));
            $attributes['is_censored'] = true;
        }

        // ② 非成员不显示消息内容（避免通过 chats 列表里的 last/first_message 泄露）
        //    - 管理员不打码
        //    - 成员（pivot 存在且 removed_at 为空）不打码
        if (!$isGuest && !$this->actor->isAdmin() && isset($attributes['message'])) {
            $chatId = $message->chat_id ?? ($message->chat->id ?? null);
            if ($chatId) {
                $pivot = ChatUser::query()
                    ->where('chat_id', $chatId)
                    ->where('user_id', $this->actor->id)
                    ->first();

                $notMember = !$pivot || $pivot->removed_at;
                if ($notMember) {
                    // 这里选择置空；也可改成用 * 打码
                    $attributes['message'] = null;
                    $attributes['is_censored'] = true;
                    $attributes['need_join'] = true;
                }
            }
        }

        return $attributes;
    }

    public function user($message)
    {
        return $this->hasOne($message, BasicUserSerializer::class);
    }

    public function deleted_by($message)
    {
        return $this->hasOne($message, BasicUserSerializer::class);
    }

    public function chat($message)
    {
        return $this->hasOne($message, ChatSerializer::class);
    }
}

