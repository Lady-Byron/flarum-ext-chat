<?php

namespace Xelson\Chat\Api\Serializers;

use Flarum\Api\Serializer\AbstractSerializer;
use Flarum\Api\Serializer\BasicUserSerializer;
use Flarum\Settings\SettingsRepositoryInterface;
use Xelson\Chat\ChatSocket;

class MessageSerializer extends AbstractSerializer
{
    /**
     * JSON:API resource type
     * @var string
     */
    protected $type = 'chatmessages';

    /**
     * @var SettingsRepositoryInterface
     */
    protected SettingsRepositoryInterface $settings;

    /**
     * Optional realtime/socket hook (kept for compatibility)
     * @var ChatSocket
     */
    protected ChatSocket $socket;

    public function __construct(SettingsRepositoryInterface $settings, ChatSocket $socket)
    {
        $this->settings = $settings;
        $this->socket = $socket;
    }

    /**
     * @param object|array $message
     * @return array
     */
    protected function getDefaultAttributes($message): array
    {
        // Note: keep original behavior but avoid leaking ip_address
        $attributes = $message->getAttributes();
        unset($attributes['ip_address']);

        $attributes['created_at'] = $this->formatDate($message->created_at);

        if ($message->edited_at) {
            $attributes['edited_at'] = $this->formatDate($message->edited_at);
        }

        // Censor message for guests if enabled
        $censorEnabled = (bool) $this->settings->get('xelson-chat.settings.display.censor');
        $isGuest = !($this->actor && $this->actor->id);

        if ($censorEnabled && $isGuest && isset($attributes['message'])) {
            $attributes['message'] = str_repeat('*', mb_strlen((string) $attributes['message']));
            $attributes['is_censored'] = true;
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
