// js/src/admin/index.js
// [FIX] Flarum 1.8：将开关项的 type 从 'switch' 改为 'boolean'（1.x 文档记录的类型）
// [VERIFIED] registerPermission 的分组(view/start/reply/moderate)与 allowGuest 用法符合 1.x

import app from 'flarum/admin/app';

app.initializers.add('xelson-chat', () => {
  app.extensionData
    .for('xelson-chat')
    .registerSetting({
      setting: 'xelson-chat.settings.charlimit',
      label: app.translator.trans('xelson-chat.admin.settings.charlimit'),
      type: 'number',
    })
    .registerSetting({
      setting: 'xelson-chat.settings.floodgate.number',
      label: app.translator.trans('xelson-chat.admin.settings.floodgate.number'),
      type: 'number',
    })
    .registerSetting({
      setting: 'xelson-chat.settings.floodgate.time',
      label: app.translator.trans('xelson-chat.admin.settings.floodgate.time'),
      type: 'text',
    })
    .registerSetting({
      setting: 'xelson-chat.settings.display.minimize',
      label: app.translator.trans('xelson-chat.admin.settings.display.minimize'),
      type: 'boolean', // [FIX] 1.8 使用 boolean（而非 switch 别名）
    })
    .registerSetting({
      setting: 'xelson-chat.settings.display.censor',
      label: app.translator.trans('xelson-chat.admin.settings.display.censor'),
      type: 'boolean', // [FIX] 同上
    })
    .registerPermission(
      {
        icon: 'fas fa-eye',
        label: app.translator.trans('xelson-chat.admin.permissions.enabled'),
        permission: 'xelson-chat.permissions.enabled',
        allowGuest: true,
      },
      'view'
    )
    .registerPermission(
      {
        icon: 'fas fa-comment-medical',
        label: app.translator.trans('xelson-chat.admin.permissions.create.chat'),
        permission: 'xelson-chat.permissions.create',
      },
      'start'
    )
    .registerPermission(
      {
        icon: 'fas fa-comment-medical',
        label: app.translator.trans('xelson-chat.admin.permissions.create.channel'),
        permission: 'xelson-chat.permissions.create.channel',
      },
      'start'
    )
    .registerPermission(
      {
        icon: 'fas fa-comments',
        label: app.translator.trans('xelson-chat.admin.permissions.post'),
        permission: 'xelson-chat.permissions.chat',
      },
      'reply'
    )
    .registerPermission(
      {
        icon: 'fas fa-pencil-alt',
        label: app.translator.trans('xelson-chat.admin.permissions.edit'),
        permission: 'xelson-chat.permissions.edit',
      },
      'reply'
    )
    .registerPermission(
      {
        icon: 'far fa-trash-alt',
        label: app.translator.trans('xelson-chat.admin.permissions.delete'),
        permission: 'xelson-chat.permissions.delete',
      },
      'reply'
    )
    .registerPermission(
      {
        icon: 'fas fa-eye',
        label: app.translator.trans('xelson-chat.admin.permissions.moderate.vision'),
        permission: 'xelson-chat.permissions.moderate.vision',
      },
      'moderate'
    )
    .registerPermission(
      {
        icon: 'far fa-trash-alt',
        label: app.translator.trans('xelson-chat.admin.permissions.moderate.delete'),
        permission: 'xelson-chat.permissions.moderate.delete',
      },
      'moderate'
    );
});
