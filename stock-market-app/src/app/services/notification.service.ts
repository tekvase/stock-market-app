import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { LivePriceService, PriceAlert } from './live-price.service';

@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private alertSub?: Subscription;
  private currentUserId: number | null = null;
  private isNative = false;

  constructor(private livePriceService: LivePriceService) {
    this.isNative = !!(window as any).Capacitor?.isNativePlatform?.();
  }

  async initialize(userId: number): Promise<void> {
    this.currentUserId = userId;

    if (this.isNative) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const perm = await LocalNotifications.requestPermissions();
        console.log('[Notifications] Permission:', perm.display);
      } catch (e) {
        console.log('[Notifications] Local notifications not available');
      }
    }

    this.alertSub = this.livePriceService.onAlert$.subscribe((alert) => {
      if (alert.userId !== this.currentUserId) return;
      this.fireNotification(alert);
    });
  }

  private async fireNotification(alert: PriceAlert): Promise<void> {
    console.log('[ALERT]', alert.message);

    if (this.isNative) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.schedule({
          notifications: [{
            title: alert.thresholdPct >= 0
              ? `${alert.symbol} +${alert.thresholdPct}%`
              : `${alert.symbol} Stop Loss`,
            body: alert.message,
            id: Date.now() % 2147483647,
            schedule: { at: new Date() },
            sound: 'default'
          }]
        });
      } catch (e) {
        // local notifications not available
      }
    }
  }

  ngOnDestroy(): void {
    this.alertSub?.unsubscribe();
  }
}
