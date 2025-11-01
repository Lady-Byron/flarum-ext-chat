<?php
/*
 * 修复说明：
 * - 原问题1：仅对 discussions.create/posts.create 进行节流，未覆盖聊天消息路由；导致聊天洪泛未被限制。
 * - 原问题2：窗口计数逻辑使用 count($last) <= $number 时不节流，等于阈值也放行；应当在 >= 阈值 时节流。
 * - 原问题3：时间窗口未明确单位；若后台保存为纯数字（秒），应构造 '-N seconds' 的相对时间更稳妥。
 */

namespace Xelson\Chat\Api\Throttler;

use DateTime;
use Flarum\User\User;
use Flarum\Settings\SettingsRepositoryInterface;
use Xelson\Chat\Message;

class ChatMessage
{
    /**
     * @var SettingsRepositoryInterface
     */
    protected $settings;

    public function __construct(SettingsRepositoryInterface $settings)
    {
        $this->settings = $settings;
    }

    /**
     * 返回 true 表示「需要节流」（拒绝本次请求）
     */
    public function __invoke($request): bool
    {
        /** @var User $actor */
        $actor = $request->getAttribute('actor');

        // 仅限制聊天消息发送接口
        if ($request->getAttribute('routeName') !== 'neonchat.chatmessages.post') {
            return false;
        }

        // 未登录不在此限流器处理（可视需要改为 true）
        if (!$actor || !$actor->id) {
            return false;
        }

        $number = (int) $this->settings->get('xelson-chat.settings.floodgate.number');
        $time   = $this->settings->get('xelson-chat.settings.floodgate.time'); // 期望为秒

        if ($number <= 0) {
            return false; // 关闭限流
        }

        // 时间窗口起点
        if (is_numeric($time)) {
            $window = new DateTime('-' . (int)$time . ' seconds');
        } else {
            // 若后台保存为 "2 minutes" 等语义字符串
            $window = new DateTime('-' . (string)$time);
        }

        $count = Message::where('created_at', '>=', $window)
            ->where('user_id', $actor->id)
            ->count();

        // 当窗口内已达阈值，则本次请求需要被限流
        return $count >= $number;
    }
}
