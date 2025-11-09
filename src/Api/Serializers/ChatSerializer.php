<?php

namespace Xelson\Chat\Api\Serializers;

use Flarum\Api\Serializer\AbstractSerializer;
use Flarum\Api\Serializer\UserSerializer;
use Flarum\Settings\SettingsRepositoryInterface;

class ChatSerializer extends AbstractSerializer
{
    protected $type = 'chats';

    protected SettingsRepositoryInterface $settings;

    public function __construct(SettingsRepositoryInterface $settings)
    {
        $this->settings = $settings;
    }

    protected function getDefaultAttributes($chat): array
    {
        $attributes = $chat->getAttributes();
        if ($chat->created_at) {
            $attributes['created_at'] = $this->formatDate($chat->created_at);
        }

        // 未加入频道 -> can_join = true
        $actor = $this->actor;
        if ($actor && (int) ($chat->type ?? 0) === 1) {
            if (method_exists($chat, 'getChatUser')) {
                $pivot = $chat->getChatUser($actor);
                if (!$pivot || $pivot->removed_at) {
                    $attributes['can_join'] = true;
                }
            }
        }

        return $attributes;
    }

    protected function creator($chat)
    {
        return $this->hasOne($chat, UserSerializer::class);
    }

    protected function users($chat)
    {
        return $this->hasMany($chat, UserChatSerializer::class);
    }

    protected function messages($chat)
    {
        return $this->hasMany($chat, MessageSerializer::class);
    }

    protected function last_message($chat)
    {
        return $this->hasOne($chat, MessageSerializer::class);
    }

    protected function first_message($chat)
    {
        return $this->hasOne($chat, MessageSerializer::class);
    }
}

