export const aboutPageContent = {
  eyebrow: 'VỀ DEMOSTORE',
  title: 'Khám phá công nghệ,',
  highlight: 'theo cách thật dễ dàng.',
  intro:
    'DemoStore là cửa hàng trực tuyến giới thiệu phụ kiện và thiết bị công nghệ. Bạn có thể tìm sản phẩm, xem thông tin chi tiết, đọc bài viết và tham khảo đánh giá — tất cả trong một trải nghiệm đơn giản, dễ theo dõi.',
  story: {
    eyebrow: 'CÂU CHUYỆN CỦA CHÚNG TÔI',
    title: 'Công nghệ dễ khám phá hơn khi thông tin được sắp xếp rõ ràng.',
    paragraphs: [
      'DemoStore được xây dựng như một điểm đến để tìm hiểu sản phẩm công nghệ. Từ danh mục và thương hiệu đến trang chi tiết, các thông tin được sắp xếp để bạn dễ tìm, dễ đọc và dễ so sánh những lựa chọn đang được giới thiệu.',
      'Bên cạnh catalog, website có bài viết, đánh giá sản phẩm và tài khoản khách hàng. Chúng tôi muốn việc tham khảo trở nên thuận tiện, dù bạn đang tìm một sản phẩm cụ thể hay chỉ đang khám phá những lựa chọn mới.',
      'DemoStore hiện ưu tiên trải nghiệm xem và tìm hiểu. Các chức năng mua hàng sẽ chỉ được giới thiệu khi đã sẵn sàng; vui lòng xem lưu ý về dịch vụ bên dưới để biết phạm vi hoạt động hiện tại.',
    ],
  },
  offerings: [
    {
      title: 'Danh mục sản phẩm',
      description:
        'Khám phá phụ kiện và thiết bị công nghệ theo danh mục, thương hiệu hoặc từ khóa.',
    },
    {
      title: 'Thông tin chi tiết',
      description:
        'Xem hình ảnh, mô tả, lựa chọn phiên bản và giá đang hiển thị trên trang sản phẩm.',
    },
    {
      title: 'Bài viết và đánh giá',
      description:
        'Đọc bài viết tham khảo và xem đánh giá được hiển thị tại từng sản phẩm.',
    },
    {
      title: 'Tài khoản khách hàng',
      description:
        'Đăng ký để quản lý hồ sơ, địa chỉ mặc định, mật khẩu và lịch sử đơn hàng hiện có.',
    },
  ],
  principles: [
    {
      title: 'Rõ ràng',
      description:
        'Thông tin sản phẩm, phiên bản và đánh giá được trình bày tại nơi bạn cần xem, giúp việc tìm hiểu dễ dàng hơn.',
    },
    {
      title: 'Thuận tiện',
      description:
        'Danh mục, tìm kiếm và bài viết giúp bạn bắt đầu từ nhu cầu của mình và lần lượt khám phá nội dung liên quan.',
    },
    {
      title: 'Minh bạch',
      description:
        'Chúng tôi phân biệt rõ tính năng đang dùng được và phần chưa triển khai, không biến nội dung tham khảo thành lời hứa giao dịch.',
    },
  ],
  steps: [
    {
      title: 'Tìm điều bạn quan tâm',
      description:
        'Chọn danh mục trên thanh điều hướng hoặc nhập tên sản phẩm, thương hiệu vào ô tìm kiếm.',
    },
    {
      title: 'Xem thông tin sản phẩm',
      description:
        'Mở sản phẩm để xem nội dung, các phiên bản và đánh giá nếu có. Thông tin có thể khác nhau giữa các sản phẩm.',
    },
    {
      title: 'Tham khảo trước khi quyết định',
      description:
        'Đọc bài viết và câu hỏi thường gặp để hiểu phạm vi dịch vụ hiện tại. Website chưa hỗ trợ đặt hàng hoặc thanh toán.',
    },
  ],
  notice: {
    title: 'Lưu ý về phạm vi dịch vụ',
    description:
      'DemoStore hiện hỗ trợ khám phá và tham khảo thông tin sản phẩm. Tính năng đặt hàng, thanh toán và gửi lời nhắn từ biểu mẫu liên hệ chưa khả dụng; các nội dung về giao hàng, đổi trả và bảo hành cần được xem tại các trang chính sách tương ứng.',
  },
} as const;

export const faqPageContent = {
  eyebrow: 'HỖ TRỢ DEMOSTORE',
  title: 'Câu hỏi thường gặp',
  intro:
    'Tìm câu trả lời về sản phẩm, tài khoản và những tính năng hiện có trên website.',
  categories: [
    {
      id: 'shopping',
      label: 'Sản phẩm',
      title: 'Tìm kiếm và xem sản phẩm',
      questions: [
        {
          id: 'find-products',
          question: 'Tôi có thể tìm sản phẩm như thế nào?',
          answer:
            'Bạn có thể khám phá theo danh mục hoặc sử dụng ô tìm kiếm ở đầu trang. Trang Khám phá hiển thị danh sách sản phẩm; chọn một sản phẩm để xem trang chi tiết.',
        },
        {
          id: 'search-by-brand',
          question: 'Tôi có thể tìm theo tên sản phẩm hoặc thương hiệu không?',
          answer:
            'Có. Nhập tên sản phẩm hoặc thương hiệu vào ô tìm kiếm trên đầu trang. Bạn cũng có thể bắt đầu từ danh mục sản phẩm để thu hẹp lựa chọn.',
        },
        {
          id: 'missing-product',
          question: 'Vì sao tôi không tìm thấy sản phẩm mình cần?',
          answer:
            'Có thể sản phẩm chưa có trong danh mục công khai, tên tìm kiếm chưa khớp hoặc catalog đang được cập nhật. Hãy thử từ khóa ngắn hơn hoặc duyệt danh mục.',
        },
        {
          id: 'product-details',
          question: 'Trang chi tiết sản phẩm có những thông tin gì?',
          answer:
            'Tùy sản phẩm, trang chi tiết có thể hiển thị hình ảnh, mô tả, thông số, các lựa chọn phiên bản và đánh giá. Hãy xem nội dung cụ thể trên trang của từng sản phẩm vì thông tin có thể khác nhau.',
        },
        {
          id: 'product-variants',
          question: 'Tôi có thể chọn phiên bản sản phẩm ở đâu?',
          answer:
            'Nếu sản phẩm có nhiều phiên bản, các lựa chọn sẽ hiển thị trên trang chi tiết. Thông tin của từng phiên bản có thể khác nhau; hãy kiểm tra lựa chọn đang hiển thị trước khi tham khảo giá.',
        },
        {
          id: 'price-availability',
          question: 'Giá và tình trạng sản phẩm có được đảm bảo không?',
          answer:
            'Đây là storefront đang trong quá trình hoàn thiện. Thông tin hiển thị nhằm mục đích tham khảo và chưa phải xác nhận cho một giao dịch. Hiện chưa có luồng đặt hàng để xác nhận giá hoặc tồn kho.',
        },
        {
          id: 'total-price',
          question:
            'Giá hiển thị có phải là tổng tiền tôi cần thanh toán không?',
          answer:
            'Không. Giá trên trang sản phẩm chỉ là thông tin đang hiển thị. Website chưa có checkout để xác nhận giá cuối cùng, phí giao hàng hay bất kỳ khoản thanh toán nào.',
        },
        {
          id: 'product-reviews',
          question: 'Tôi có thể gửi đánh giá sản phẩm không?',
          answer:
            'Một số trang chi tiết có biểu mẫu gửi đánh giá. Nếu biểu mẫu được hiển thị, bạn có thể nhập nội dung theo hướng dẫn tại đó. Đánh giá không đồng nghĩa với xác nhận rằng sản phẩm đã được mua qua storefront.',
        },
        {
          id: 'review-source',
          question: 'Làm sao để biết đánh giá đến từ đâu?',
          answer:
            'Trang sản phẩm hiển thị thông tin nguồn đánh giá khi có dữ liệu. Đánh giá do người dùng gửi không được xác nhận là đánh giá từ người đã mua hàng.',
        },
      ],
    },
    {
      id: 'account',
      label: 'Tài khoản',
      title: 'Đăng ký và tài khoản',
      questions: [
        {
          id: 'account-required',
          question: 'Tôi có cần tài khoản để xem sản phẩm không?',
          answer:
            'Không. Danh mục và thông tin sản phẩm công khai có thể được xem mà không cần đăng nhập. Tài khoản khách hàng dành cho các tính năng hồ sơ và lịch sử đơn hàng hiện có.',
        },
        {
          id: 'register-login',
          question: 'Làm thế nào để đăng ký hoặc đăng nhập?',
          answer:
            'Mở trang Thành viên để tạo tài khoản hoặc đăng nhập bằng tài khoản khách hàng.',
        },
        {
          id: 'account-features',
          question: 'Tôi có thể quản lý những gì trong tài khoản?',
          answer:
            'Tài khoản khách hàng hiện có trang hồ sơ, địa chỉ giao hàng mặc định, đổi mật khẩu và lịch sử đơn hàng gắn với tài khoản.',
        },
        {
          id: 'update-profile',
          question: 'Tôi có thể cập nhật hồ sơ khách hàng không?',
          answer:
            'Có. Trong trang hồ sơ, bạn có thể cập nhật họ tên, ngày sinh, giới tính và số điện thoại. Email đăng nhập được hiển thị để tham khảo và không chỉnh sửa tại trang này.',
        },
        {
          id: 'change-password',
          question: 'Tôi có thể đổi mật khẩu khi đang đăng nhập không?',
          answer:
            'Có. Vào mục đổi mật khẩu trong tài khoản và làm theo hướng dẫn.',
        },
        {
          id: 'forgot-password',
          question: 'Tôi có thể đặt lại mật khẩu nếu quên không?',
          answer:
            'Hiện storefront chưa có luồng tự phục vụ để đặt lại mật khẩu. Không gửi mật khẩu hoặc thông tin nhạy cảm qua biểu mẫu liên hệ.',
        },
        {
          id: 'change-email',
          question: 'Tôi có thể đổi email đăng nhập trong hồ sơ không?',
          answer:
            'Không. Email đăng nhập hiện chỉ hiển thị trong hồ sơ và không thể thay đổi từ trang tài khoản.',
        },
      ],
    },
    {
      id: 'orders',
      label: 'Đặt hàng',
      title: 'Đặt hàng và thanh toán',
      questions: [
        {
          id: 'checkout',
          question: 'Tôi có thể đặt hàng hoặc thanh toán trên website không?',
          answer:
            'Chưa. Giỏ hàng, checkout và tạo đơn hàng dành cho khách chưa được triển khai. Không chuyển khoản hoặc cung cấp thông tin thanh toán dựa trên nội dung tham khảo trên website.',
        },
        {
          id: 'order-history',
          question: 'Lịch sử đơn hàng trong tài khoản có ý nghĩa gì?',
          answer:
            'Lịch sử chỉ hiển thị các đơn hàng đã được tạo và liên kết với đúng tài khoản khách hàng. Storefront hiện không tạo đơn mới, vì vậy trang này không phải biên nhận đặt hàng từ website.',
        },
        {
          id: 'track-order',
          question: 'Tôi có thể theo dõi hoặc hủy đơn hàng ở đây không?',
          answer:
            'Website hiện chỉ hỗ trợ xem danh sách lịch sử đơn hàng có sẵn trong tài khoản; chưa có quy trình đặt hàng, theo dõi giao hàng hoặc hủy đơn dành cho khách.',
        },
        {
          id: 'order-confirmation',
          question: 'Làm thế nào để biết website đã nhận đơn hàng của tôi?',
          answer:
            'DemoStore chưa nhận đơn đặt hàng trực tuyến. Việc xem sản phẩm hoặc đăng ký tài khoản không tạo đơn hàng; chỉ các đơn hàng có sẵn mới xuất hiện trong lịch sử tài khoản.',
        },
      ],
    },
    {
      id: 'policies',
      label: 'Giao hàng & chính sách',
      title: 'Giao hàng, đổi trả và bảo hành',
      questions: [
        {
          id: 'shipping-cost',
          question: 'Phí và thời gian giao hàng là bao nhiêu?',
          answer:
            'Chưa có đơn hàng trực tuyến nên website hiện chưa công bố phí hoặc thời gian giao hàng. Không nên dựa vào thời hạn ước tính chưa được xác nhận.',
        },
        {
          id: 'returns-warranty',
          question: 'Chính sách đổi trả và bảo hành như thế nào?',
          answer:
            'Vui lòng xem các trang chính sách tương ứng trên website để biết điều kiện áp dụng. FAQ không thay thế nội dung chính sách chính thức.',
        },
        {
          id: 'shipping-address',
          question: 'Địa chỉ giao hàng trong hồ sơ được dùng để làm gì?',
          answer:
            'Đây là thông tin địa chỉ mặc định được lưu riêng trong hồ sơ khách hàng. Vì checkout chưa khả dụng, việc lưu địa chỉ hiện không tạo đơn hoặc yêu cầu giao hàng.',
        },
        {
          id: 'edit-address',
          question: 'Tôi có thể lưu hoặc sửa địa chỉ mặc định không?',
          answer:
            'Tài khoản có mục địa chỉ để lưu hoặc cập nhật địa chỉ mặc định. Địa chỉ này hiện chưa được dùng để tạo yêu cầu giao hàng vì checkout chưa khả dụng.',
        },
      ],
    },
    {
      id: 'help',
      label: 'Hỗ trợ',
      title: 'Liên hệ và góp ý',
      questions: [
        {
          id: 'contact-form',
          question: 'Tôi có thể gửi câu hỏi qua trang Liên hệ không?',
          answer:
            'Trang Liên hệ hiện có giao diện nhập lời nhắn nhưng chưa kết nối dịch vụ gửi. Vì vậy, gửi biểu mẫu chưa chuyển thông tin đến đội ngũ hỗ trợ và chưa tạo yêu cầu cần phản hồi.',
        },
        {
          id: 'safe-use',
          question: 'Tôi cần lưu ý gì khi sử dụng DemoStore?',
          answer:
            'Hãy xem website như một trải nghiệm khám phá và tham khảo sản phẩm. Không nhập dữ liệu thanh toán, thông tin định danh nhạy cảm hoặc mật khẩu vào các biểu mẫu không có chức năng tương ứng.',
        },
        {
          id: 'technical-issue',
          question: 'Tôi gặp lỗi khi xem trang hoặc sản phẩm thì nên làm gì?',
          answer:
            'Tải lại trang và thử lại sau. Trang Liên hệ hiện chưa gửi thông tin đến đội ngũ hỗ trợ.',
        },
      ],
    },
  ],
} as const;
